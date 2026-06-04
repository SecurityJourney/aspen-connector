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
 *
 * Requires GitLab 15.x or later for CI_COMMIT_COMMITTER_EMAIL.
 */
export class GitLabProvider {
  async getMetadata() {
    const iid = process.env.CI_MERGE_REQUEST_IID;

    return {
      headSha:        process.env.CI_COMMIT_SHA,
      committerEmail: process.env.CI_COMMIT_COMMITTER_EMAIL || process.env.GITLAB_USER_EMAIL,
      repo:           process.env.CI_PROJECT_PATH,
      username:       process.env.GITLAB_USER_LOGIN,
      // Guard against non-numeric values returning NaN
      prNumber:       iid && /^\d+$/.test(iid) ? parseInt(iid, 10) : null,
      branch:         process.env.CI_COMMIT_REF_NAME,
    };
  }

  async commitFile({ filePath, content, message }) {
    const branch = process.env.CI_COMMIT_REF_NAME;
    if (!branch) throw new Error('CI_COMMIT_REF_NAME is not set — cannot determine target branch');

    // Resolve to absolute path and verify it's within the repo root.
    // Prevents path traversal via ASPEN_INSTRUCTION_FILE_PATH.
    const repoRoot = process.cwd();
    const resolvedPath = resolve(filePath);
    if (!resolvedPath.startsWith(repoRoot + '/') && resolvedPath !== repoRoot) {
      throw new Error(`Instruction file path "${filePath}" is outside the repository root`);
    }

    writeFileSync(resolvedPath, content, 'utf8');
    console.log(`[aspen-connector] Written updated content to ${filePath}`);

    // Use run() (spawnSync, no shell) for all git commands so user-controlled values
    // — email, name, filePath, branch — are never interpreted by a shell.
    const email = process.env.GITLAB_USER_EMAIL || 'aspen-bot@noreply.securityjourney.com';
    const name  = process.env.GITLAB_USER_NAME  || 'aspen-bot';
    run('git', ['config', 'user.email', email]);
    run('git', ['config', 'user.name',  name]);
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
  const result = spawnSync('git', ['diff', '--staged', '--quiet'], { stdio: 'pipe' });
  return result.status !== 0; // non-zero = changes staged
}
