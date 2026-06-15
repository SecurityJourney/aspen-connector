/**
 * Tests for src/lib/git.js
 *
 * Covers: buildGitBlock — required fields, optional fields, exclude list
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGitBlock } from '../src/lib/git.js';

describe('buildGitBlock', () => {
  const fullMetadata = {
    headSha: 'abc123def456',
    committerEmail: 'dev@example.com',
    repo: 'org/repo',
    username: 'devuser',
    prNumber: '42',
  };

  it('returns null when headSha is missing', () => {
    const meta = { committerEmail: 'dev@example.com', repo: 'org/repo' };
    assert.equal(buildGitBlock(meta, []), null);
  });

  it('returns null when committerEmail is missing', () => {
    const meta = { headSha: 'abc123', repo: 'org/repo' };
    assert.equal(buildGitBlock(meta, []), null);
  });

  it('returns null when both headSha and committerEmail are missing', () => {
    assert.equal(buildGitBlock({ repo: 'org/repo' }, []), null);
  });

  it('returns null when metadata is empty', () => {
    assert.equal(buildGitBlock({}, []), null);
  });

  it('builds git block with required fields', () => {
    const meta = { headSha: 'abc123', committerEmail: 'dev@example.com' };
    const result = buildGitBlock(meta, []);
    assert.deepEqual(result, {
      commitSha: 'abc123',
      committerEmail: 'dev@example.com',
    });
  });

  it('includes optional fields when present and not excluded', () => {
    const result = buildGitBlock(fullMetadata, []);
    assert.deepEqual(result, {
      commitSha: 'abc123def456',
      committerEmail: 'dev@example.com',
      repo: 'org/repo',
      username: 'devuser',
      prNumber: '42',
    });
  });

  it('omits repo when excluded', () => {
    const result = buildGitBlock(fullMetadata, ['repo']);
    assert.ok(!('repo' in result));
    assert.equal(result.commitSha, 'abc123def456');
    assert.equal(result.username, 'devuser');
  });

  it('omits username when excluded', () => {
    const result = buildGitBlock(fullMetadata, ['username']);
    assert.ok(!('username' in result));
    assert.equal(result.repo, 'org/repo');
  });

  it('omits prNumber when excluded', () => {
    const result = buildGitBlock(fullMetadata, ['prNumber']);
    assert.ok(!('prNumber' in result));
    assert.equal(result.repo, 'org/repo');
  });

  it('excludes multiple fields at once', () => {
    const result = buildGitBlock(fullMetadata, [
      'repo',
      'username',
      'prNumber',
    ]);
    assert.deepEqual(result, {
      commitSha: 'abc123def456',
      committerEmail: 'dev@example.com',
    });
  });

  it('does not include optional fields when they are absent from metadata', () => {
    const meta = { headSha: 'sha1', committerEmail: 'dev@example.com' };
    const result = buildGitBlock(meta, []);
    assert.ok(!('repo' in result));
    assert.ok(!('username' in result));
    assert.ok(!('prNumber' in result));
  });

  it('treats null excludeFields the same as empty array', () => {
    const meta = {
      headSha: 'sha1',
      committerEmail: 'dev@example.com',
      repo: 'org/repo',
    };
    const result = buildGitBlock(meta, null);
    assert.equal(result.repo, 'org/repo');
  });

  it('treats undefined excludeFields the same as empty array', () => {
    const meta = {
      headSha: 'sha1',
      committerEmail: 'dev@example.com',
      repo: 'org/repo',
    };
    const result = buildGitBlock(meta, undefined);
    assert.equal(result.repo, 'org/repo');
  });
});
