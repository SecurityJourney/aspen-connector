/**
 * Tests for src/modes/extract.js
 *
 * Covers:
 * - Happy path: reads file, calls API, returns { cwes, recorded }
 * - Throws when scan results file cannot be read
 * - Throws on network error
 * - Throws on HTTP error response
 * - Throws on non-JSON response
 * - Includes git block when metadata is available
 * - Omits git block (and warns) when metadata is unavailable
 * - Sends X-Scanner-Type header when scannerType is provided
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock modules before importing extract.js
// ---------------------------------------------------------------------------

const mockFiles = {};

mock.module('fs', {
  namedExports: {
    readFileSync: (path, _encoding) => {
      if (path in mockFiles) return mockFiles[path];
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, open '${path}'`),
        { code: 'ENOENT' },
      );
    },
  },
});

mock.module('../src/lib/git.js', {
  namedExports: {
    buildGitBlock: (metadata, _excludeFields) => {
      if (!metadata.headSha || !metadata.committerEmail) return null;
      return {
        commitSha: metadata.headSha,
        committerEmail: metadata.committerEmail,
      };
    },
  },
});

const { runExtractMode } = await import('../src/modes/extract.js');

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SCAN_PATH = '/tmp/extract-scan.json';
const scanData = { runs: [{ tool: { driver: { name: 'SnykCode' } } }] };

const fakeProvider = {
  getMetadata: async () => ({
    headSha: 'abc123',
    committerEmail: 'ci@example.com',
    repo: 'org/repo',
    username: 'ciuser',
    prNumber: null,
  }),
};

const noGitProvider = {
  getMetadata: async () => ({ headSha: '', committerEmail: '' }),
};

const baseInputs = {
  scanResultsPath: SCAN_PATH,
  scannerType: null,
  apiToken: 'tok',
  apiDomain: 'api.securityjourney.com',
  excludeGitMetadataFields: [],
};

const callerMetadata = { source: 'SOURCE_GITLAB', aspen_version: '0.1.0' };

function makeOkFetch(cwes = ['CWE-89'], recorded = true) {
  return mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    json: async () => ({ cwes, recorded }),
    text: async () => '',
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runExtractMode', () => {
  let fetchMock;

  beforeEach(() => {
    mockFiles[SCAN_PATH] = JSON.stringify(scanData);
  });

  afterEach(() => {
    fetchMock?.mock.restore();
    delete mockFiles[SCAN_PATH];
  });

  it('returns cwes and recorded from the API response', async () => {
    fetchMock = makeOkFetch(['CWE-89', 'CWE-79'], true);
    const result = await runExtractMode({
      inputs: baseInputs,
      provider: fakeProvider,
      callerMetadata,
    });
    assert.deepEqual(result.cwes, ['CWE-89', 'CWE-79']);
    assert.equal(result.recorded, true);
  });

  it('POSTs to the correct extract-cwes endpoint', async () => {
    let capturedUrl;
    fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ cwes: [], recorded: false }),
        text: async () => '',
      };
    });

    await runExtractMode({
      inputs: baseInputs,
      provider: fakeProvider,
      callerMetadata,
    });
    assert.equal(
      capturedUrl,
      'https://api.securityjourney.com/guardian/scan/extract-cwes',
    );
  });

  it('includes scan_results and caller_metadata in request body', async () => {
    let capturedBody;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ cwes: [], recorded: false }),
        text: async () => '',
      };
    });

    await runExtractMode({
      inputs: baseInputs,
      provider: fakeProvider,
      callerMetadata,
    });
    assert.deepEqual(capturedBody.scan_results, scanData);
    assert.deepEqual(capturedBody.caller_metadata, callerMetadata);
  });

  it('includes git block when metadata is available', async () => {
    let capturedBody;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ cwes: [], recorded: false }),
        text: async () => '',
      };
    });

    await runExtractMode({
      inputs: baseInputs,
      provider: fakeProvider,
      callerMetadata,
    });
    assert.ok(capturedBody.git, 'git block should be present');
    assert.equal(capturedBody.git.commitSha, 'abc123');
  });

  it('omits git block when metadata is unavailable', async () => {
    let capturedBody;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ cwes: [], recorded: false }),
        text: async () => '',
      };
    });

    await runExtractMode({
      inputs: baseInputs,
      provider: noGitProvider,
      callerMetadata,
    });
    assert.equal(capturedBody.git, undefined);
  });

  it('sends X-Scanner-Type header when scannerType is provided', async () => {
    let capturedHeaders;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ cwes: [], recorded: false }),
        text: async () => '',
      };
    });

    await runExtractMode({
      inputs: { ...baseInputs, scannerType: 'snyk' },
      provider: fakeProvider,
      callerMetadata,
    });
    assert.equal(capturedHeaders['X-Scanner-Type'], 'snyk');
  });

  it('omits X-Scanner-Type header when scannerType is null', async () => {
    let capturedHeaders;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({ cwes: [], recorded: false }),
        text: async () => '',
      };
    });

    await runExtractMode({
      inputs: baseInputs,
      provider: fakeProvider,
      callerMetadata,
    });
    assert.equal(capturedHeaders['X-Scanner-Type'], undefined);
  });

  it('throws when scan results file cannot be read', async () => {
    fetchMock = makeOkFetch();
    await assert.rejects(
      () =>
        runExtractMode({
          inputs: { ...baseInputs, scanResultsPath: '/nonexistent/scan.json' },
          provider: fakeProvider,
          callerMetadata,
        }),
      /Failed to read or parse scan results/,
    );
  });

  it('throws on HTTP error response', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    }));

    await assert.rejects(
      () =>
        runExtractMode({
          inputs: baseInputs,
          provider: fakeProvider,
          callerMetadata,
        }),
      (err) => {
        assert.ok(err.message.includes('500'));
        return true;
      },
    );
  });

  it('throws on network error', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    await assert.rejects(
      () =>
        runExtractMode({
          inputs: baseInputs,
          provider: fakeProvider,
          callerMetadata,
        }),
      /ECONNREFUSED/,
    );
  });

  it('throws when response is not valid JSON', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
      text: async () => '',
    }));

    await assert.rejects(
      () =>
        runExtractMode({
          inputs: baseInputs,
          provider: fakeProvider,
          callerMetadata,
        }),
      /not valid JSON/,
    );
  });
});
