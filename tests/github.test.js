/**
 * Tests for src/providers/github.js
 *
 * Covers:
 * - getMetadata(): reads all fields from GitHub Actions env vars
 * - getMetadata(): prNumber parsed from GITHUB_REF for pull_request events
 * - getMetadata(): prNumber is null for push events (no refs/pull/ in GITHUB_REF)
 * - getMetadata(): committerEmail uses GITHUB_ACTOR_ID+ACTOR noreply when available
 * - getMetadata(): committerEmail falls back to bot address when GITHUB_ACTOR_ID is absent
 * - getMetadata(): branch uses GITHUB_HEAD_REF for PRs, GITHUB_REF_NAME for pushes
 * - commitFile(): throws when branch env vars are both unset
 * - commitFile(): throws when GITHUB_TOKEN is not set
 * - commitFile(): throws when filePath resolves outside the repo root
 * - commitFile(): writes file content to disk
 * - commitFile(): runs git add, commit, and push when staged changes exist
 * - commitFile(): passes commit message as a separate arg (no shell escaping)
 * - commitFile(): skips commit and push when no staged changes
 * - commitFile(): uses bot defaults when ASPEN_GIT_USER_EMAIL/NAME are not set
 * - commitFile(): uses ASPEN_GIT_USER_EMAIL/NAME when set
 * - commitFile(): pushes to HEAD:<branch>
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock child_process and fs before importing github.js
// ---------------------------------------------------------------------------

const spawnCalls = [];
let hasChanges = true;

mock.module('child_process', {
  namedExports: {
    spawnSync: (cmd, args, _opts) => {
      spawnCalls.push({ cmd, args });
      if (args.includes('--staged') && args.includes('--quiet')) {
        return { status: hasChanges ? 1 : 0 };
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

const { GitHubProvider } = await import('../src/providers/github.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'GITHUB_SHA', 'GITHUB_REPOSITORY', 'GITHUB_ACTOR', 'GITHUB_ACTOR_ID',
  'GITHUB_REF', 'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_TOKEN',
  'ASPEN_GIT_USER_EMAIL', 'ASPEN_GIT_USER_NAME',
];

function setGitHubEnv(overrides = {}) {
  const defaults = {
    GITHUB_SHA:        'abc123',
    GITHUB_REPOSITORY: 'org/repo',
    GITHUB_ACTOR:      'ciuser',
    GITHUB_ACTOR_ID:   '12345',
    GITHUB_REF:        'refs/heads/feature/my-branch',
    GITHUB_HEAD_REF:   'feature/my-branch',
    GITHUB_REF_NAME:   'feature/my-branch',
    GITHUB_TOKEN:      'ghs_token123',
  };
  const env = { ...defaults, ...overrides };
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearGitHubEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

describe('GitHubProvider.getMetadata()', () => {
  beforeEach(clearGitHubEnv);
  afterEach(clearGitHubEnv);

  it('reads headSha from GITHUB_SHA', async () => {
    setGitHubEnv({ GITHUB_SHA: 'deadbeef' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.headSha, 'deadbeef');
  });

  it('reads repo from GITHUB_REPOSITORY', async () => {
    setGitHubEnv({ GITHUB_REPOSITORY: 'myorg/myrepo' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.repo, 'myorg/myrepo');
  });

  it('reads username from GITHUB_ACTOR', async () => {
    setGitHubEnv({ GITHUB_ACTOR: 'johndoe' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.username, 'johndoe');
  });

  it('builds committerEmail from GITHUB_ACTOR_ID and GITHUB_ACTOR', async () => {
    setGitHubEnv({ GITHUB_ACTOR_ID: '99', GITHUB_ACTOR: 'testuser' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.committerEmail, '99+testuser@users.noreply.github.com');
  });

  it('falls back to bot address when GITHUB_ACTOR_ID is absent', async () => {
    setGitHubEnv({ GITHUB_ACTOR_ID: null, GITHUB_ACTOR: 'testuser' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.committerEmail, 'github-actions[bot]@users.noreply.github.com');
  });

  it('falls back to bot address when both GITHUB_ACTOR_ID and GITHUB_ACTOR are absent', async () => {
    setGitHubEnv({ GITHUB_ACTOR_ID: null, GITHUB_ACTOR: null });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.committerEmail, 'github-actions[bot]@users.noreply.github.com');
  });

  it('reads branch from GITHUB_HEAD_REF for pull_request events', async () => {
    setGitHubEnv({ GITHUB_HEAD_REF: 'feature/my-pr-branch', GITHUB_REF_NAME: '123/merge' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.branch, 'feature/my-pr-branch');
  });

  it('reads branch from GITHUB_REF_NAME when GITHUB_HEAD_REF is absent (push events)', async () => {
    setGitHubEnv({ GITHUB_HEAD_REF: null, GITHUB_REF_NAME: 'main' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.branch, 'main');
  });

  it('parses prNumber from GITHUB_REF for pull_request events', async () => {
    setGitHubEnv({ GITHUB_REF: 'refs/pull/42/merge' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.prNumber, 42);
  });

  it('sets prNumber to null for push events (no refs/pull/ in GITHUB_REF)', async () => {
    setGitHubEnv({ GITHUB_REF: 'refs/heads/main' });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.prNumber, null);
  });

  it('sets prNumber to null when GITHUB_REF is absent', async () => {
    setGitHubEnv({ GITHUB_REF: null });
    const meta = await new GitHubProvider().getMetadata();
    assert.equal(meta.prNumber, null);
  });
});

// ---------------------------------------------------------------------------
// commitFile
// ---------------------------------------------------------------------------

describe('GitHubProvider.commitFile()', () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    hasChanges = true;
    clearGitHubEnv();
    setGitHubEnv();
    for (const key of Object.keys(writtenFiles)) delete writtenFiles[key];
  });

  afterEach(clearGitHubEnv);

  it('throws when both GITHUB_HEAD_REF and GITHUB_REF_NAME are unset', async () => {
    delete process.env.GITHUB_HEAD_REF;
    delete process.env.GITHUB_REF_NAME;
    await assert.rejects(
      () => new GitHubProvider().commitFile({ filePath: 'src/file.md', content: 'x', message: 'msg' }),
      /GITHUB_HEAD_REF.*GITHUB_REF_NAME/
    );
  });

  it('throws when GITHUB_TOKEN is not set', async () => {
    delete process.env.GITHUB_TOKEN;
    await assert.rejects(
      () => new GitHubProvider().commitFile({ filePath: 'src/file.md', content: 'x', message: 'msg' }),
      /GITHUB_TOKEN/
    );
  });

  it('throws when filePath resolves outside the repo root', async () => {
    await assert.rejects(
      () => new GitHubProvider().commitFile({ filePath: '../../etc/passwd', content: 'x', message: 'msg' }),
      /outside the repository root/
    );
  });

  it('writes the file content to disk', async () => {
    await new GitHubProvider().commitFile({
      filePath: 'src/instructions.md',
      content: 'updated content',
      message: 'update instructions',
    });
    const resolvedKey = Object.keys(writtenFiles).find((k) => k.endsWith('src/instructions.md'));
    assert.ok(resolvedKey, 'file should have been written');
    assert.equal(writtenFiles[resolvedKey], 'updated content');
  });

  it('runs git add, commit, and push when staged changes exist', async () => {
    hasChanges = true;
    await new GitHubProvider().commitFile({
      filePath: 'src/instructions.md',
      content: 'x',
      message: 'update',
    });

    const commands = spawnCalls.map((c) => c.args[0]);
    assert.ok(commands.includes('add'),    'git add should be called');
    assert.ok(commands.includes('commit'), 'git commit should be called');
    assert.ok(commands.includes('push'),   'git push should be called');
  });

  it('passes the commit message as a separate arg (no shell escaping)', async () => {
    hasChanges = true;
    const message = 'update instructions [skip ci]';
    await new GitHubProvider().commitFile({ filePath: 'src/f.md', content: 'x', message });

    const commitCall = spawnCalls.find((c) => c.args[0] === 'commit');
    assert.ok(commitCall, 'git commit should be called');
    assert.equal(commitCall.args[commitCall.args.indexOf('-m') + 1], message);
  });

  it('skips commit and push when no staged changes', async () => {
    hasChanges = false;
    await new GitHubProvider().commitFile({
      filePath: 'src/instructions.md',
      content: 'x',
      message: 'update',
    });

    const commands = spawnCalls.map((c) => c.args[0]);
    assert.ok(!commands.includes('commit'), 'git commit should not be called');
    assert.ok(!commands.includes('push'),   'git push should not be called');
  });

  it('uses bot defaults when ASPEN_GIT_USER_EMAIL and ASPEN_GIT_USER_NAME are not set', async () => {
    delete process.env.ASPEN_GIT_USER_EMAIL;
    delete process.env.ASPEN_GIT_USER_NAME;

    await new GitHubProvider().commitFile({ filePath: 'src/f.md', content: 'x', message: 'msg' });

    const emailCall = spawnCalls.find((c) => c.args[0] === 'config' && c.args[1] === 'user.email');
    assert.equal(emailCall.args[2], 'github-actions[bot]@users.noreply.github.com');

    const nameCall = spawnCalls.find((c) => c.args[0] === 'config' && c.args[1] === 'user.name');
    assert.equal(nameCall.args[2], 'github-actions[bot]');
  });

  it('uses ASPEN_GIT_USER_EMAIL and ASPEN_GIT_USER_NAME when set', async () => {
    process.env.ASPEN_GIT_USER_EMAIL = 'bot@example.com';
    process.env.ASPEN_GIT_USER_NAME  = 'My Bot';

    await new GitHubProvider().commitFile({ filePath: 'src/f.md', content: 'x', message: 'msg' });

    const emailCall = spawnCalls.find((c) => c.args[0] === 'config' && c.args[1] === 'user.email');
    assert.equal(emailCall.args[2], 'bot@example.com');

    const nameCall = spawnCalls.find((c) => c.args[0] === 'config' && c.args[1] === 'user.name');
    assert.equal(nameCall.args[2], 'My Bot');
  });

  it('pushes to HEAD:<branch> using GITHUB_HEAD_REF', async () => {
    process.env.GITHUB_HEAD_REF = 'feature/my-branch';
    await new GitHubProvider().commitFile({ filePath: 'src/f.md', content: 'x', message: 'msg' });

    const pushCall = spawnCalls.find((c) => c.args[0] === 'push');
    assert.ok(pushCall, 'git push should be called');
    assert.ok(pushCall.args.some((a) => a.includes('HEAD:feature/my-branch')));
  });

  it('pushes to HEAD:<branch> using GITHUB_REF_NAME when GITHUB_HEAD_REF is absent', async () => {
    delete process.env.GITHUB_HEAD_REF;
    process.env.GITHUB_REF_NAME = 'main';

    await new GitHubProvider().commitFile({ filePath: 'src/f.md', content: 'x', message: 'msg' });

    const pushCall = spawnCalls.find((c) => c.args[0] === 'push');
    assert.ok(pushCall, 'git push should be called');
    assert.ok(pushCall.args.some((a) => a.includes('HEAD:main')));
  });

  it('configures git auth via the http extraheader (not the remote URL)', async () => {
    await new GitHubProvider().commitFile({ filePath: 'src/f.md', content: 'x', message: 'msg' });

    const configCall = spawnCalls.find(
      (c) => c.args[0] === 'config' && c.args.some((a) => a.includes('extraheader'))
    );
    assert.ok(configCall, 'git config extraheader should be called');

    const headerValue = configCall.args[configCall.args.length - 1];
    assert.ok(headerValue.startsWith('Authorization: basic '), 'header should be a basic auth header');

    const encoded = headerValue.replace('Authorization: basic ', '');
    const decoded  = Buffer.from(encoded, 'base64').toString('utf8');
    assert.equal(decoded, 'x-access-token:ghs_token123');
  });
});
