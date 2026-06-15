/**
 * Tests for src/providers/index.js
 *
 * Covers: detectProvider(), detectSource() — CI platform detection
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { detectProvider, detectSource } from '../src/providers/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setGitLab() {
  process.env.GITLAB_CI = 'true';
  delete process.env.GITHUB_ACTIONS;
}

function setGitHub() {
  process.env.GITHUB_ACTIONS = 'true';
  delete process.env.GITLAB_CI;
}

function clearPlatformEnv() {
  delete process.env.GITLAB_CI;
  delete process.env.GITHUB_ACTIONS;
}

// ---------------------------------------------------------------------------
// detectSource
// ---------------------------------------------------------------------------

describe('detectSource', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      GITLAB_CI: process.env.GITLAB_CI,
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    };
  });

  afterEach(() => {
    if (savedEnv.GITLAB_CI !== undefined)
      process.env.GITLAB_CI = savedEnv.GITLAB_CI;
    else delete process.env.GITLAB_CI;
    if (savedEnv.GITHUB_ACTIONS !== undefined)
      process.env.GITHUB_ACTIONS = savedEnv.GITHUB_ACTIONS;
    else delete process.env.GITHUB_ACTIONS;
  });

  it('returns SOURCE_GITLAB when GITLAB_CI=true', () => {
    setGitLab();
    assert.equal(detectSource(), 'SOURCE_GITLAB');
  });

  it('returns SOURCE_GITHUB when GITHUB_ACTIONS=true', () => {
    setGitHub();
    assert.equal(detectSource(), 'SOURCE_GITHUB');
  });

  it('returns null when neither platform env is set', () => {
    clearPlatformEnv();
    assert.equal(detectSource(), null);
  });

  it('prefers GITLAB_CI when both are set', () => {
    process.env.GITLAB_CI = 'true';
    process.env.GITHUB_ACTIONS = 'true';
    assert.equal(detectSource(), 'SOURCE_GITLAB');
  });
});

// ---------------------------------------------------------------------------
// detectProvider
// ---------------------------------------------------------------------------

describe('detectProvider', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = {
      GITLAB_CI: process.env.GITLAB_CI,
      GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
    };
  });

  afterEach(() => {
    if (savedEnv.GITLAB_CI !== undefined)
      process.env.GITLAB_CI = savedEnv.GITLAB_CI;
    else delete process.env.GITLAB_CI;
    if (savedEnv.GITHUB_ACTIONS !== undefined)
      process.env.GITHUB_ACTIONS = savedEnv.GITHUB_ACTIONS;
    else delete process.env.GITHUB_ACTIONS;
  });

  it('returns a GitLab provider when GITLAB_CI=true', () => {
    setGitLab();
    const provider = detectProvider();
    // Provider should have a getMetadata function
    assert.equal(typeof provider.getMetadata, 'function');
    assert.equal(typeof provider.commitFile, 'function');
  });

  it('returns a GitHub provider when GITHUB_ACTIONS=true', () => {
    setGitHub();
    const provider = detectProvider();
    assert.equal(typeof provider.getMetadata, 'function');
    assert.equal(typeof provider.commitFile, 'function');
  });

  it('throws when neither platform env is set', () => {
    clearPlatformEnv();
    assert.throws(
      () => detectProvider(),
      (err) => {
        assert.ok(err.message.includes('Unsupported CI platform'));
        return true;
      },
    );
  });

  it('error message mentions both supported platforms', () => {
    clearPlatformEnv();
    assert.throws(
      () => detectProvider(),
      (err) => {
        assert.ok(
          err.message.includes('GitLab') || err.message.includes('GITLAB_CI'),
        );
        assert.ok(
          err.message.includes('GitHub') ||
            err.message.includes('GITHUB_ACTIONS'),
        );
        return true;
      },
    );
  });

  it('GitLab provider is different instance from GitHub provider', () => {
    setGitLab();
    const gitlabProvider = detectProvider();

    setGitHub();
    const githubProvider = detectProvider();

    // Different constructors
    assert.notEqual(gitlabProvider.constructor, githubProvider.constructor);
  });
});
