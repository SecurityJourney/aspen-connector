import { spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

/**
 * GitLab CI provider.
 *
 * Reads all metadata from GitLab predefined CI/CD variables — no API calls needed.
 *
 * Commit-back authenticates via CI_JOB_TOKEN. The pipeline must configure the
 * git remote with the token before running aspen:
 *
 *   git remote set-url origin \
 *     "https://gitlab-ci-token:${CI_JOB_TOKEN}@${CI_SERVER_HOST}/${CI_PROJECT_PATH}.git"
 */
export class GitLabProvider {
  async getMetadata() {
    const iid = process.env.CI_MERGE_REQUEST_IID;

    // On merge_request_event pipelines, CI_COMMIT_SHA is GitLab's synthetic
    // "merged results" test-merge commit, not the actual MR branch commit —
    // CI_COMMIT_COMMITTER_EMAIL is frequently empty for it. Read the real
    // committer straight from git history off the actual source branch head,
    // same as the GitHub provider does, rather than trusting predefined vars.
    // GITLAB_USER_EMAIL is the *pipeline-triggering account's* email, which
    // may differ from the git commit's author (e.g. a personal address on
    // the GitLab account vs. a work address in git config) — last resort only.
    const isMR = process.env.CI_PIPELINE_SOURCE === 'merge_request_event';
    const headSha =
      (isMR && process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA) ||
      process.env.CI_COMMIT_SHA;

    return {
      headSha,
      committerEmail: getCommitterEmail(headSha),
      repo: process.env.CI_PROJECT_PATH,
      username: process.env.GITLAB_USER_LOGIN,
      // Guard against non-numeric values returning NaN
      prNumber: iid && /^\d+$/.test(iid) ? parseInt(iid, 10) : null,
      branch: process.env.CI_COMMIT_REF_NAME,
    };
  }

  async commentOnPullRequest({ prNumber, body }) {
    const serverUrl = process.env.CI_SERVER_URL;
    if (!serverUrl) throw new Error('CI_SERVER_URL is not set');

    const projectId = process.env.CI_PROJECT_ID;
    if (!projectId) throw new Error('CI_PROJECT_ID is not set');

    // GITLAB_TOKEN (a PAT/project access token with `api` scope) authenticates via
    // PRIVATE-TOKEN. Falling back to CI_JOB_TOKEN, which authenticates via JOB-TOKEN
    // and only works when the project allows job token API access
    // (Settings → CI/CD → Token Access).
    const patToken = process.env.GITLAB_TOKEN;
    const jobToken = process.env.CI_JOB_TOKEN;
    if (!patToken && !jobToken)
      throw new Error(
        'Neither GITLAB_TOKEN nor CI_JOB_TOKEN is set — required to comment on a merge request',
      );

    const url = `${serverUrl}/api/v4/projects/${projectId}/merge_requests/${prNumber}/notes`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(patToken
          ? { 'PRIVATE-TOKEN': patToken }
          : { 'JOB-TOKEN': jobToken }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `GitLab API returned HTTP ${response.status} when posting MR comment: ${text.slice(0, 300)}`,
      );
    }

    console.log(`[aspen-connector] Posted comment to MR !${prNumber}`);
  }

  async commitFile({ filePath, content, message }) {
    const branch = process.env.CI_COMMIT_REF_NAME;
    if (!branch)
      throw new Error(
        'CI_COMMIT_REF_NAME is not set — cannot determine target branch',
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

    writeFileSync(resolvedPath, content, 'utf8');
    console.log(`[aspen-connector] Written updated content to ${filePath}`);

    // Use run() (spawnSync, no shell) for all git commands so user-controlled values
    // — email, name, filePath, branch — are never interpreted by a shell.
    const email =
      process.env.GITLAB_USER_EMAIL || 'aspen-bot@noreply.securityjourney.com';
    const name = process.env.GITLAB_USER_NAME || 'aspen-bot';
    run('git', ['config', 'user.email', email]);
    run('git', ['config', 'user.name', name]);
    run('git', ['add', resolvedPath]);

    if (!hasStaged()) {
      console.log('[aspen-connector] No changes to commit');
      return;
    }

    // Pass message as a separate arg — no shell escaping needed
    run('git', ['commit', '-m', message]);
    console.log('[aspen-connector] Committed changes');

    run('git', ['push', 'origin', `HEAD:${branch}`]);
    console.log(`[aspen-connector] Pushed to ${branch}`);
  }
}

/**
 * Runs a git command without a shell. Args are never interpreted — safe for
 * user-controlled values (email, name, file paths, branch names).
 */
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

/**
 * Returns true if there are staged changes ready to commit.
 */
function hasStaged() {
  const result = spawnSync('git', ['diff', '--staged', '--quiet'], {
    stdio: 'pipe',
  });
  return result.status !== 0; // non-zero = changes staged
}

/**
 * Reads the author email of `sha` from git history. Falls back to
 * CI_COMMIT_COMMITTER_EMAIL / GITLAB_USER_EMAIL if the commit isn't reachable
 * (e.g. shallow clone) or `sha` is unset.
 */
function getCommitterEmail(sha) {
  if (sha) {
    const result = spawnSync('git', ['log', '-1', '--format=%ae', sha], {
      encoding: 'utf8',
    });
    const email = result.status === 0 ? result.stdout?.trim() : undefined;
    if (email) return email;
  }
  return process.env.CI_COMMIT_COMMITTER_EMAIL || process.env.GITLAB_USER_EMAIL;
}
