import { spawnSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * GitHub Actions provider.
 *
 * Reads metadata from GitHub Actions predefined environment variables — no API calls needed.
 *
 * Commit-back authenticates via GITHUB_TOKEN using git's http.extraheader mechanism.
 * This avoids embedding the token in the remote URL where it could appear in process
 * listings or error output.
 *
 * Workflow requirements:
 *   permissions:
 *     contents: write   # needed for commit-back
 *
 * For pull_request events:
 *   - branch  → GITHUB_HEAD_REF   (the PR source branch, e.g. "feature/my-branch")
 *   - prNumber → parsed from GITHUB_REF ("refs/pull/123/merge")
 *
 * For push events:
 *   - branch  → GITHUB_REF_NAME   (e.g. "main")
 *   - prNumber → null
 */
export class GitHubProvider {
  async getMetadata() {
    const eventName = process.env.GITHUB_EVENT_NAME;
    if (eventName !== 'pull_request' && eventName !== 'push') {
      throw new Error(
        `Unsupported GitHub Actions event "${eventName}". Aspen supports pull_request and push events only.`,
      );
    }

    const isPR = eventName === 'pull_request';

    const ref = process.env.GITHUB_REF ?? '';
    const prMatch = ref.match(/refs\/pull\/(\d+)\//);
    const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;

    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;

    const actor = process.env.GITHUB_ACTOR;

    // Read the actual author email from the triggering commit.
    // GitHub doesn't expose it as an env var, but it's in git history after checkout.
    const gitLog = spawnSync('git', ['log', '-1', '--format=%ae'], {
      encoding: 'utf8',
    });
    if (gitLog.status !== 0 || gitLog.error) {
      throw new Error(
        'Could not determine committer email from git log — ensure actions/checkout has run before this action',
      );
    }
    const committerEmail = gitLog.stdout?.trim();
    if (!committerEmail)
      throw new Error(
        'Could not determine committer email from git log — ensure actions/checkout has run before this action',
      );

    // For pull_request events, GITHUB_SHA is the synthetic merge commit GitHub creates
    // to preview the merge — not the actual PR branch head. The event payload written
    // to GITHUB_EVENT_PATH contains the real PR head SHA at pull_request.head.sha.
    let headSha;
    if (isPR) {
      try {
        const eventPath = process.env.GITHUB_EVENT_PATH;
        if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
        const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
        headSha = payload.pull_request?.head?.sha;
        if (!headSha)
          throw new Error('pull_request.head.sha missing from event payload');
      } catch (e) {
        throw new Error(
          `Could not read PR head SHA from event payload: ${e.message}`,
        );
      }
    } else {
      headSha = process.env.GITHUB_SHA;
    }

    return {
      headSha,
      committerEmail,
      repo: process.env.GITHUB_REPOSITORY,
      username: actor,
      prNumber,
      branch,
    };
  }

  async commentOnPullRequest({ prNumber, body }) {
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      throw new Error(
        'GITHUB_TOKEN is not set — required to comment on a pull request',
      );

    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo) throw new Error('GITHUB_REPOSITORY is not set');

    // The Issues API handles comments for both issues and PRs on GitHub.
    const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `GitHub API returned HTTP ${response.status} when posting PR comment: ${text.slice(0, 300)}`,
      );
    }

    console.log(`[aspen-connector] Posted comment to PR #${prNumber}`);
  }

  async commitFile({ filePath, content, message }) {
    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
    if (!branch) {
      throw new Error(
        'Neither GITHUB_HEAD_REF nor GITHUB_REF_NAME is set — cannot determine target branch',
      );
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token)
      throw new Error(
        'GITHUB_TOKEN is not set — required for commit-back in GitHub Actions',
      );

    // Resolve to absolute path and verify it's within the repo root.
    // Prevents path traversal via ASPEN_INSTRUCTION_FILE_PATH.
    const repoRoot = process.cwd();
    const resolvedPath = resolve(filePath);
    if (!resolvedPath.startsWith(repoRoot + '/') && resolvedPath !== repoRoot) {
      throw new Error(
        `Instruction file path "${filePath}" is outside the repository root`,
      );
    }

    // Configure git auth via extraheader. Using stdio:'pipe' so the base64-encoded
    // token is never written to the job log.
    const encodedToken = Buffer.from(`x-access-token:${token}`).toString(
      'base64',
    );
    runQuiet('git', [
      'config',
      '--local',
      'http.https://github.com/.extraheader',
      `Authorization: basic ${encodedToken}`,
    ]);

    writeFileSync(resolvedPath, content, 'utf8');
    console.log(`[aspen-connector] Written updated content to ${filePath}`);

    // spawnSync (no shell) — user-controlled values are never interpreted by a shell.
    const email =
      process.env.ASPEN_GIT_USER_EMAIL ||
      'github-actions[bot]@users.noreply.github.com';
    const name = process.env.ASPEN_GIT_USER_NAME || 'github-actions[bot]';
    run('git', ['config', 'user.email', email]);
    run('git', ['config', 'user.name', name]);
    run('git', ['add', resolvedPath]);

    if (!hasStaged()) {
      console.log('[aspen-connector] No changes to commit');
      return;
    }

    run('git', ['commit', '-m', message]);
    console.log('[aspen-connector] Committed changes');

    run('git', ['push', 'origin', `HEAD:${branch}`]);
    console.log(`[aspen-connector] Pushed to ${branch}`);
  }
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

// Suppresses all output — used for commands whose args contain secrets.
function runQuiet(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'pipe' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args[0]}`);
  }
}

function hasStaged() {
  const result = spawnSync('git', ['diff', '--staged', '--quiet'], {
    stdio: 'pipe',
  });
  return result.status !== 0;
}
