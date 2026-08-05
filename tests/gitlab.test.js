/**
 * Tests for src/providers/gitlab.js
 *
 * Covers:
 * - getMetadata(): reads all fields from CI env vars
 * - getMetadata(): committerEmail is read from `git log` on the real commit,
 *   preferred over CI_COMMIT_COMMITTER_EMAIL/GITLAB_USER_EMAIL
 * - getMetadata(): prNumber is null when CI_MERGE_REQUEST_IID is absent or non-numeric
 * - commitFile(): throws when CI_COMMIT_REF_NAME is not set
 * - commitFile(): throws when filePath resolves outside the repo root
 * - commitFile(): writes file, stages, commits, and pushes when changes are staged
 * - commitFile(): skips commit and push when no staged changes
 * - commitFile(): uses GITLAB_USER_EMAIL/NAME when set, otherwise bot defaults
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock child_process and fs before importing gitlab.js
// ---------------------------------------------------------------------------

// spawnSync calls are recorded here so tests can assert on them
const spawnCalls = [];

// Controls whether `git diff --staged --quiet` exits non-zero (changes staged)
let hasChanges = true;

// Controls the `git log -1 --format=%ae <sha>` result. `null` simulates the
// commit not being reachable (e.g. shallow clone) — status 128, no stdout.
let gitLogEmail = 'real-author@example.com';

mock.module('child_process', {
  namedExports: {
    spawnSync: (cmd, args, _opts) => {
      spawnCalls.push({ cmd, args });
      // git diff --staged --quiet: status 1 means changes staged, 0 means none
      if (args.includes('--staged') && args.includes('--quiet')) {
        return { status: hasChanges ? 1 : 0 };
      }
      // git log -1 --format=%ae <sha>
      if (args[0] === 'log') {
        if (gitLogEmail === null) return { status: 128, stdout: '' };
        return { status: 0, stdout: `${gitLogEmail}\n` };
      }
      return { status: 0 };
    },
  },
});

const writtenFiles = {};
mock.module('fs', {
  namedExports: {
    writeFileSync: (path, content, _encoding) => {
      writtenFiles[path] = content;
    },
  },
});

const { GitLabProvider } = await import('../src/providers/gitlab.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'CI_COMMIT_SHA',
  'CI_COMMIT_COMMITTER_EMAIL',
  'GITLAB_USER_EMAIL',
  'CI_PROJECT_PATH',
  'GITLAB_USER_LOGIN',
  'CI_MERGE_REQUEST_IID',
  'CI_COMMIT_REF_NAME',
  'GITLAB_USER_NAME',
  'CI_PIPELINE_SOURCE',
  'CI_MERGE_REQUEST_SOURCE_BRANCH_SHA',
];

function setGitLabEnv(overrides = {}) {
  const defaults = {
    CI_COMMIT_SHA: 'abc123',
    CI_COMMIT_COMMITTER_EMAIL: 'committer@example.com',
    CI_PROJECT_PATH: 'org/repo',
    GITLAB_USER_LOGIN: 'ciuser',
    CI_COMMIT_REF_NAME: 'feature/my-branch',
  };
  const env = { ...defaults, ...overrides };
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearGitLabEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

describe('GitLabProvider.getMetadata()', () => {
  beforeEach(() => {
    clearGitLabEnv();
    gitLogEmail = 'real-author@example.com';
    spawnCalls.length = 0;
  });
  afterEach(clearGitLabEnv);

  it('reads headSha from CI_COMMIT_SHA', async () => {
    setGitLabEnv({ CI_COMMIT_SHA: 'deadbeef' });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.headSha, 'deadbeef');
  });

  it('reads committerEmail from git log on CI_COMMIT_SHA (push pipeline)', async () => {
    setGitLabEnv({ CI_COMMIT_SHA: 'deadbeef' });
    gitLogEmail = 'real-author@example.com';
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.committerEmail, 'real-author@example.com');
    const logCall = spawnCalls.find((c) => c.args[0] === 'log');
    assert.ok(logCall, 'git log should be called');
    assert.ok(logCall.args.includes('deadbeef'));
  });

  it('reads committerEmail from git log on CI_MERGE_REQUEST_SOURCE_BRANCH_SHA (MR pipeline)', async () => {
    setGitLabEnv({
      CI_PIPELINE_SOURCE: 'merge_request_event',
      CI_COMMIT_SHA: 'merge-ref-sha',
      CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: 'real-branch-sha',
    });
    gitLogEmail = 'real-author@example.com';
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.committerEmail, 'real-author@example.com');
    const logCall = spawnCalls.find((c) => c.args[0] === 'log');
    assert.ok(logCall.args.includes('real-branch-sha'));
  });

  it('falls back to CI_COMMIT_COMMITTER_EMAIL when git log fails', async () => {
    setGitLabEnv({
      CI_COMMIT_SHA: 'deadbeef',
      CI_COMMIT_COMMITTER_EMAIL: 'committer@example.com',
    });
    gitLogEmail = null;
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.committerEmail, 'committer@example.com');
  });

  it('falls back to GITLAB_USER_EMAIL when git log fails and CI_COMMIT_COMMITTER_EMAIL is absent', async () => {
    setGitLabEnv({
      CI_COMMIT_SHA: 'deadbeef',
      CI_COMMIT_COMMITTER_EMAIL: null,
      GITLAB_USER_EMAIL: 'fallback@example.com',
    });
    gitLogEmail = null;
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.committerEmail, 'fallback@example.com');
  });

  it('reads repo from CI_PROJECT_PATH', async () => {
    setGitLabEnv({ CI_PROJECT_PATH: 'myorg/myrepo' });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.repo, 'myorg/myrepo');
  });

  it('reads username from GITLAB_USER_LOGIN', async () => {
    setGitLabEnv({ GITLAB_USER_LOGIN: 'johndoe' });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.username, 'johndoe');
  });

  it('reads branch from CI_COMMIT_REF_NAME', async () => {
    setGitLabEnv({ CI_COMMIT_REF_NAME: 'main' });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.branch, 'main');
  });

  it('parses prNumber from CI_MERGE_REQUEST_IID when set', async () => {
    setGitLabEnv({ CI_MERGE_REQUEST_IID: '42' });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.prNumber, 42);
  });

  it('sets prNumber to null when CI_MERGE_REQUEST_IID is absent', async () => {
    setGitLabEnv({ CI_MERGE_REQUEST_IID: null });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.prNumber, null);
  });

  it('sets prNumber to null when CI_MERGE_REQUEST_IID is non-numeric', async () => {
    setGitLabEnv({ CI_MERGE_REQUEST_IID: 'not-a-number' });
    const meta = await new GitLabProvider().getMetadata();
    assert.equal(meta.prNumber, null);
  });
});

// ---------------------------------------------------------------------------
// commitFile
// ---------------------------------------------------------------------------

describe('GitLabProvider.commitFile()', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    hasChanges = true;
    clearGitLabEnv();
    setGitLabEnv();
    for (const key of Object.keys(writtenFiles)) delete writtenFiles[key];
  });

  afterEach(clearGitLabEnv);

  it('throws when CI_COMMIT_REF_NAME is not set', async () => {
    delete process.env.CI_COMMIT_REF_NAME;
    await assert.rejects(
      () =>
        new GitLabProvider().commitFile({
          filePath: 'src/file.md',
          content: 'x',
          message: 'msg',
        }),
      /CI_COMMIT_REF_NAME is not set/,
    );
  });

  it('throws when filePath resolves outside the repo root', async () => {
    await assert.rejects(
      () =>
        new GitLabProvider().commitFile({
          filePath: '../../etc/passwd',
          content: 'x',
          message: 'msg',
        }),
      /outside the repository root/,
    );
  });

  it('writes the file content to disk', async () => {
    await new GitLabProvider().commitFile({
      filePath: 'src/instructions.md',
      content: 'updated content',
      message: 'update instructions',
    });
    const resolvedKey = Object.keys(writtenFiles).find((k) =>
      k.endsWith('src/instructions.md'),
    );
    assert.ok(resolvedKey, 'file should have been written');
    assert.equal(writtenFiles[resolvedKey], 'updated content');
  });

  it('runs git add, commit, and push when staged changes exist', async () => {
    hasChanges = true;
    await new GitLabProvider().commitFile({
      filePath: 'src/instructions.md',
      content: 'x',
      message: 'update',
    });

    const commands = spawnCalls.map((c) => c.args[0]);
    assert.ok(commands.includes('add'), 'git add should be called');
    assert.ok(commands.includes('commit'), 'git commit should be called');
    assert.ok(commands.includes('push'), 'git push should be called');
  });

  it('passes the commit message as a separate arg (no shell escaping)', async () => {
    hasChanges = true;
    const message = 'update instructions [skip ci]';
    await new GitLabProvider().commitFile({
      filePath: 'src/f.md',
      content: 'x',
      message,
    });

    const commitCall = spawnCalls.find((c) => c.args[0] === 'commit');
    assert.ok(commitCall, 'git commit should be called');
    assert.equal(commitCall.args[commitCall.args.indexOf('-m') + 1], message);
  });

  it('skips commit and push when no staged changes', async () => {
    hasChanges = false;
    await new GitLabProvider().commitFile({
      filePath: 'src/instructions.md',
      content: 'x',
      message: 'update',
    });

    const commands = spawnCalls.map((c) => c.args[0]);
    assert.ok(!commands.includes('commit'), 'git commit should not be called');
    assert.ok(!commands.includes('push'), 'git push should not be called');
  });

  it('uses bot defaults when GITLAB_USER_EMAIL and GITLAB_USER_NAME are not set', async () => {
    delete process.env.GITLAB_USER_EMAIL;
    delete process.env.GITLAB_USER_NAME;

    await new GitLabProvider().commitFile({
      filePath: 'src/f.md',
      content: 'x',
      message: 'msg',
    });

    const emailCall = spawnCalls.find(
      (c) => c.args[0] === 'config' && c.args[1] === 'user.email',
    );
    assert.equal(emailCall.args[2], 'aspen-bot@noreply.securityjourney.com');

    const nameCall = spawnCalls.find(
      (c) => c.args[0] === 'config' && c.args[1] === 'user.name',
    );
    assert.equal(nameCall.args[2], 'aspen-bot');
  });

  it('uses GITLAB_USER_EMAIL and GITLAB_USER_NAME when set', async () => {
    process.env.GITLAB_USER_EMAIL = 'dev@example.com';
    process.env.GITLAB_USER_NAME = 'Dev User';

    await new GitLabProvider().commitFile({
      filePath: 'src/f.md',
      content: 'x',
      message: 'msg',
    });

    const emailCall = spawnCalls.find(
      (c) => c.args[0] === 'config' && c.args[1] === 'user.email',
    );
    assert.equal(emailCall.args[2], 'dev@example.com');

    const nameCall = spawnCalls.find(
      (c) => c.args[0] === 'config' && c.args[1] === 'user.name',
    );
    assert.equal(nameCall.args[2], 'Dev User');
  });

  it('pushes to HEAD:<branch>', async () => {
    process.env.CI_COMMIT_REF_NAME = 'feature/my-branch';
    await new GitLabProvider().commitFile({
      filePath: 'src/f.md',
      content: 'x',
      message: 'msg',
    });

    const pushCall = spawnCalls.find((c) => c.args[0] === 'push');
    assert.ok(pushCall, 'git push should be called');
    assert.ok(pushCall.args.some((a) => a.includes('HEAD:feature/my-branch')));
  });
});
