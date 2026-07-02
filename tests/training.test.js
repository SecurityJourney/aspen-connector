/**
 * Tests for src/modes/training.js
 *
 * Covers:
 * - pass on compliant=true
 * - fail on compliant=false
 * - fail on blockingAssignments
 * - fail on blocked status
 * - pass on non-blocking status
 * - fail-open behavior for network errors
 * - fail-open behavior for malformed JSON
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runTrainingMode } from '../src/modes/training.js';

const baseInputs = {
  apiToken: 'tok',
  apiDomain: 'api.securityjourney.com',
  trainingStatusPath: '/integrations/training/assignment-status',
  trainingRequiredAssignments: [],
  trainingBlockingStatuses: ['incomplete', 'overdue', 'failed'],
  trainingFailOpen: false,
  metadata: {
    headSha: 'abc123',
    committerEmail: 'dev@example.com',
    repo: 'org/repo',
    username: 'devuser',
    prNumber: 12,
    branch: 'feature/test',
  },
};

const callerMetadata = {
  source: 'SOURCE_GITHUB',
  aspen_version: '0.1.2',
};

describe('runTrainingMode', () => {
  let fetchMock;

  afterEach(() => {
    fetchMock?.mock.restore();
  });

  it('passes when compliant=true', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ compliant: true }),
      text: async () => '',
    }));

    const result = await runTrainingMode({
      inputs: baseInputs,
      callerMetadata,
    });

    assert.equal(result.compliant, true);
  });

  it('fails when compliant=false', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ compliant: false, reason: '2 overdue assignments' }),
      text: async () => '',
    }));

    await assert.rejects(
      () =>
        runTrainingMode({
          inputs: baseInputs,
          callerMetadata,
        }),
      /Training gate failed: 2 overdue assignments/,
    );
  });

  it('fails when blockingAssignments are present', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({
        blockingAssignments: [{ title: 'Secure Coding 101' }],
      }),
      text: async () => '',
    }));

    await assert.rejects(
      () =>
        runTrainingMode({
          inputs: baseInputs,
          callerMetadata,
        }),
      /Training gate failed: blocking assignments: Secure Coding 101/,
    );
  });

  it('fails when status is in the blocking set', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ status: 'overdue' }),
      text: async () => '',
    }));

    await assert.rejects(
      () =>
        runTrainingMode({
          inputs: baseInputs,
          callerMetadata,
        }),
      /Training gate failed: status=overdue/,
    );
  });

  it('passes when status is not blocked', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ status: 'complete' }),
      text: async () => '',
    }));

    const result = await runTrainingMode({
      inputs: baseInputs,
      callerMetadata,
    });

    assert.equal(result.status, 'complete');
  });

  it('supports fail-open on network failure', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    const result = await runTrainingMode({
      inputs: { ...baseInputs, trainingFailOpen: true },
      callerMetadata,
    });

    assert.equal(result.failOpen, true);
    assert.equal(result.compliant, true);
  });

  it('supports fail-open on malformed JSON responses', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      text: async () => '',
    }));

    const result = await runTrainingMode({
      inputs: { ...baseInputs, trainingFailOpen: true },
      callerMetadata,
    });

    assert.equal(result.failOpen, true);
    assert.equal(result.compliant, true);
  });

  it('sends requiredAssignments and subject in payload', async () => {
    let capturedBody;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ compliant: true }),
        text: async () => '',
      };
    });

    await runTrainingMode({
      inputs: {
        ...baseInputs,
        trainingRequiredAssignments: ['secure-coding-101', 'owasp-top-10'],
      },
      callerMetadata,
    });

    assert.deepEqual(capturedBody.requiredAssignments, [
      'secure-coding-101',
      'owasp-top-10',
    ]);
    assert.equal(capturedBody.subject.committerEmail, 'dev@example.com');
  });
});
