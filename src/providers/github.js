import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
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
    const ref = process.env.GITHUB_REF ?? '';
    const prMatch = ref.match(/refs\/pull\/(\d+)\//);
    const prNumber = prMatch ? parseInt(prMatch[1], 10) : null;

    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;

    // GitHub doesn't expose committer email directly.
    // Use the actor's canonical noreply address when GITHUB_ACTOR_ID is available;
    // fall back to the generic Actions bot address.
    const actorId = process.env.GITHUB_ACTOR_ID;
    const actor   = process.env.GITHUB_ACTOR;
    const committerEmail = (actorId && actor)
      ? `${actorId}+${actor}@users.noreply.github.com`
      : 'github-actions[bot]@users.noreply.github.com';

    return {
      headSha:        process.env.GITHUB_SHA,
      committerEmail,
      repo:           process.env.GITHUB_REPOSITORY,
      username:       actor,
      prNumber,
      branch,
    };
  }

  async commitFile({ filePath, content, message }) {
    const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
    if (!branch) {
      throw new Error('Neither GITHUB_HEAD_REF nor GITHUB_REF_NAME is set — cannot determine target branch');
    }

    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error('GITHUB_TOKEN is not set — required for commit-back in GitHub Actions');

    // Resolve to absolute path and verify it's within the repo root.
    // Prevents path traversal via ASPEN_INSTRUCTION_FILE_PATH.
    const repoRoot = process.cwd();
    const resolvedPath = resolve(filePath);
    if (!resolvedPath.startsWith(repoRoot + '/') && resolvedPath !== repoRoot) {
      throw new Error(`Instruction file path "${filePath}" is outside the repository root`);
    }

    writeFileSync(resolvedPath, content, 'utf8');
    console.log(`[aspen-connector] Written updated content to ${filePath}`);

    // Configure git auth via extraheader. Using stdio:'pipe' so the base64-encoded
    // token is never written to the job log.
    const encodedToken = Buffer.from(`x-access-token:${token}`).toString('base64');
    runQuiet('git', ['config', '--local', 'http.https://github.com/.extraheader', `Authorization: basic ${encodedToken}`]);

    // spawnSync (no shell) — user-controlled values are never interpreted by a shell.
    const email = process.env.ASPEN_GIT_USER_EMAIL || 'github-actions[bot]@users.noreply.github.com';
    const name  = process.env.ASPEN_GIT_USER_NAME  || 'github-actions[bot]';
    run('git', ['config', 'user.email', email]);
    run('git', ['config', 'user.name',  name]);
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
  const result = spawnSync('git', ['diff', '--staged', '--quiet'], { stdio: 'pipe' });
  return result.status !== 0;
}
