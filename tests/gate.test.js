/**
 * Tests for src/modes/gate.js
 *
 * Covers:
 * - pass when compliant=true
 * - fail when compliant=false, with reason from the API or summarized from
 *   incomplete requiredAssignments
 * - fail-open behavior for network errors, timeouts, malformed JSON,
 *   a missing result, a per-result error, and a missing "compliant" field
 * - PR comment posted on failure, and comment failures don't mask the gate error
 * - committerEmail is required; username alone is not sufficient
 * - request is a POST with {emails: [committerEmail]} as the JSON body
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runGateMode } from '../src/modes/gate.js';

const baseInputs = {
  apiToken: 'tok',
  apiDomain: 'api.securityjourney.com',
  failOpen: false,
  commentOnFailure: false,
  metadata: {
    headSha: 'abc123',
    committerEmail: 'dev@example.com',
    repo: 'org/repo',
    username: 'devuser',
    prNumber: 12,
    branch: 'feature/test',
  },
};

const noopProvider = { commentOnPullRequest: async () => {} };

function jsonResponse(body) {
  return { ok: true, json: async () => body, text: async () => '' };
}

describe('runGateMode', () => {
  let fetchMock;

  afterEach(() => {
    fetchMock?.mock.restore();
  });

  it('passes when the committer is compliant, without posting a comment', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [{ email: 'dev@example.com', compliant: true }],
      }),
    );

    const comments = [];
    const provider = {
      commentOnPullRequest: async ({ prNumber, body }) => {
        comments.push({ prNumber, body });
      },
    };

    const result = await runGateMode({
      inputs: { ...baseInputs, commentOnFailure: true },
      provider,
    });

    assert.equal(result.results[0].compliant, true);
    assert.equal(comments.length, 0);
  });

  it('fails when the committer is not compliant, using the API reason', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [
          {
            email: 'dev@example.com',
            compliant: false,
            reason: 'user has not completed all required assignments',
          },
        ],
      }),
    );

    await assert.rejects(
      () => runGateMode({ inputs: baseInputs, provider: noopProvider }),
      /Gate check failed: user has not completed all required assignments/,
    );
  });

  it('summarizes incomplete requiredAssignments when the API omits a reason', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [
          {
            email: 'dev@example.com',
            compliant: false,
            requiredAssignments: [
              {
                id: '1',
                title: 'Secure Coding 101',
                status: 'ASSIGNMENT_STATUS_IN_PROGRESS',
              },
              {
                id: '2',
                title: 'Phishing Awareness',
                status: 'ASSIGNMENT_STATUS_PASSED',
              },
            ],
          },
        ],
      }),
    );

    await assert.rejects(
      () => runGateMode({ inputs: baseInputs, provider: noopProvider }),
      /Gate check failed: incomplete: Secure Coding 101/,
    );
  });

  it('supports fail-open on network failure', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await runGateMode({
      inputs: { ...baseInputs, failOpen: true },
      provider: noopProvider,
    });

    assert.equal(result.failOpen, true);
    assert.equal(result.allowed, true);
  });

  it('supports fail-open on malformed JSON responses', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      text: async () => '',
    }));

    const result = await runGateMode({
      inputs: { ...baseInputs, failOpen: true },
      provider: noopProvider,
    });

    assert.equal(result.failOpen, true);
    assert.equal(result.allowed, true);
  });

  it('respects fail-open when there is no result for the committer', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ results: [] }),
    );

    await assert.rejects(
      () => runGateMode({ inputs: baseInputs, provider: noopProvider }),
      /no result for the committer email/,
    );

    const result = await runGateMode({
      inputs: { ...baseInputs, failOpen: true },
      provider: noopProvider,
    });
    assert.equal(result.failOpen, true);
  });

  it('respects fail-open when the result has a per-user error', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [{ email: 'dev@example.com', error: 'user not found' }],
      }),
    );

    await assert.rejects(
      () => runGateMode({ inputs: baseInputs, provider: noopProvider }),
      /Gate could not evaluate committer: user not found/,
    );

    const result = await runGateMode({
      inputs: { ...baseInputs, failOpen: true },
      provider: noopProvider,
    });
    assert.equal(result.failOpen, true);
  });

  it('respects fail-open when compliant is missing from the result', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({ results: [{ email: 'dev@example.com' }] }),
    );

    await assert.rejects(
      () => runGateMode({ inputs: baseInputs, provider: noopProvider }),
      /missing "compliant"/,
    );

    const result = await runGateMode({
      inputs: { ...baseInputs, failOpen: true },
      provider: noopProvider,
    });
    assert.equal(result.failOpen, true);
  });

  it('sends a POST request with {emails: [committerEmail]} as the JSON body', async () => {
    let capturedUrl;
    let capturedOpts;
    fetchMock = mock.method(globalThis, 'fetch', async (url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return jsonResponse({
        results: [{ email: 'dev@example.com', compliant: true }],
      });
    });

    await runGateMode({ inputs: baseInputs, provider: noopProvider });

    const url = new URL(capturedUrl);
    assert.equal(url.origin, 'https://api.securityjourney.com');
    assert.equal(url.pathname, '/integrations/learner-compliance/status');
    assert.equal(capturedOpts.method, 'POST');
    assert.deepEqual(JSON.parse(capturedOpts.body), {
      emails: ['dev@example.com'],
    });
    assert.equal(capturedOpts.headers.Authorization, 'Bearer tok');
    assert.equal(capturedOpts.headers['Content-Type'], 'application/json');
  });

  it('fails when committerEmail is missing, even if username is present', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [{ email: 'dev@example.com', compliant: true }],
      }),
    );

    await assert.rejects(
      () =>
        runGateMode({
          inputs: {
            ...baseInputs,
            metadata: { ...baseInputs.metadata, committerEmail: undefined },
          },
          provider: noopProvider,
        }),
      /No committer email available/,
    );

    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('supports fail-open when committerEmail is missing', async () => {
    const result = await runGateMode({
      inputs: {
        ...baseInputs,
        failOpen: true,
        metadata: { ...baseInputs.metadata, committerEmail: undefined },
      },
      provider: noopProvider,
    });

    assert.equal(result.failOpen, true);
    assert.equal(result.allowed, true);
  });

  it('posts a PR comment with the reason when the gate blocks', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [
          {
            email: 'dev@example.com',
            compliant: false,
            reason: 'failed assessment',
          },
        ],
      }),
    );

    const comments = [];
    const provider = {
      commentOnPullRequest: async ({ prNumber, body }) => {
        comments.push({ prNumber, body });
      },
    };

    await assert.rejects(() =>
      runGateMode({
        inputs: { ...baseInputs, commentOnFailure: true },
        provider,
      }),
    );

    assert.equal(comments.length, 1);
    assert.equal(comments[0].prNumber, 12);
    assert.equal(comments[0].body, 'failed assessment');
  });

  it('a comment-posting failure does not mask the gate error', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      jsonResponse({
        results: [
          { email: 'dev@example.com', compliant: false, reason: 'blocked' },
        ],
      }),
    );

    const provider = {
      commentOnPullRequest: async () => {
        throw new Error('403 Forbidden');
      },
    };

    await assert.rejects(
      () =>
        runGateMode({
          inputs: { ...baseInputs, commentOnFailure: true },
          provider,
        }),
      /Gate check failed: blocked/,
    );
  });
});
