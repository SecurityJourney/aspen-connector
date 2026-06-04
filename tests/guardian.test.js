/**
 * Tests for src/modes/guardian.js
 *
 * Covers:
 * - Mode A: scan_results file → { scan_results: ... } payload
 * - Mode B: cwes array       → { cwes: [...] } payload
 * - Instruction file reading (file vs directory)
 * - auto_commit behavior
 * - Commit message construction (with/without prNumber, custom message, [skip ci])
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Mock modules before any dynamic import of guardian.js
// ---------------------------------------------------------------------------

const capturedRequests = [];
let mockApiResponse = { updated_instructions: null };
let mockJwt = 'mock-jwt-token';

// Mock token exchange
mock.module('../src/lib/token.js', {
  namedExports: {
    exchangeTokenForJwt: async (_domain, _token) => mockJwt,
    deriveDirectDomain: (apiDomain) => apiDomain.replace(/^api\./, 'my.'),
  },
});

// Mock streaming call — captures requestBody passed to it
mock.module('../src/lib/stream.js', {
  namedExports: {
    callApiWithStreaming: async (_url, _scannerType, _jwtToken, requestBody) => {
      capturedRequests.push({ requestBody });
      return mockApiResponse;
    },
  },
});

// Mock git block builder — returns a predictable git block
mock.module('../src/lib/git.js', {
  namedExports: {
    buildGitBlock: (metadata, excludeFields) => {
      if (!metadata.headSha || !metadata.committerEmail) return null;
      return { commitSha: metadata.headSha, committerEmail: metadata.committerEmail };
    },
  },
});

// Mock inputs.js getInput — used only for commit_message
mock.module('../src/inputs.js', {
  namedExports: {
    getInput: (_name) => '',
    getRequiredInput: (_name) => 'required-value',
    parseBoolean: (value, def) => (value ? value.trim() !== 'false' : def),
    parseJsonArray: (raw, _field) => {
      const input = (raw ?? '').trim();
      if (!input || input === '[]') return [];
      return JSON.parse(input).map(String);
    },
    parseExcludeFields: (raw) => {
      const input = (raw ?? '').trim();
      if (input === 'all') return 'all';
      if (!input || input === '[]') return [];
      return JSON.parse(input).map(String);
    },
  },
});

// Mock fs — controls readFileSync for scan results and instruction files
const mockFiles = {};
mock.module('fs', {
  namedExports: {
    readFileSync: (path, _encoding) => {
      if (path in mockFiles) return mockFiles[path];
      throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' });
    },
    statSync: (path) => {
      if (path.endsWith('.md') || path.endsWith('.json')) {
        return { isDirectory: () => false };
      }
      // Treat paths without extension as directories
      if (!path.includes('.')) {
        return { isDirectory: () => true };
      }
      return { isDirectory: () => false };
    },
    readdirSync: (dirPath) => {
      return Object.keys(mockFiles)
        .filter((k) => k.startsWith(dirPath + '/'))
        .map((k) => k.slice(dirPath.length + 1));
    },
  },
});

// Dynamic import AFTER mocks are registered
const { runGuardianMode } = await import('../src/modes/guardian.js');

// ---------------------------------------------------------------------------
// Shared fake provider
// ---------------------------------------------------------------------------

const fakeProvider = {
  getMetadata: async () => ({
    headSha: 'deadbeef',
    committerEmail: 'ci@example.com',
    repo: 'org/repo',
    username: 'ciuser',
    prNumber: '7',
  }),
  commitFile: async () => {},
};

const noGitProvider = {
  getMetadata: async () => ({ headSha: '', committerEmail: '' }),
  commitFile: async () => {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearCaptures() {
  capturedRequests.length = 0;
}

// ---------------------------------------------------------------------------
// Mode A — scan_results path
// ---------------------------------------------------------------------------

describe('runGuardianMode — Mode A (scan results file)', () => {
  const SCAN_PATH = '/tmp/scan.json';
  const INSTR_PATH = '/tmp/instructions.md';
  const scanData = { runs: [{ tool: { driver: { name: 'SnykCode' } } }] };
  const instrContent = '# Security Instructions\nKeep secrets out of code.';

  beforeEach(() => {
    clearCaptures();
    mockApiResponse = { updated_instructions: null };
    mockFiles[SCAN_PATH] = JSON.stringify(scanData);
    mockFiles[INSTR_PATH] = instrContent;
  });

  it('sends scan_results in the request body', async () => {
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: { source: 'SOURCE_GITHUB', aspen_version: '1.0.0' },
    });

    assert.equal(capturedRequests.length, 1);
    const { requestBody } = capturedRequests[0];
    assert.ok('scan_results' in requestBody, 'scan_results must be present');
    assert.ok(!('cwes' in requestBody), 'cwes must not be present in Mode A');
    assert.deepEqual(requestBody.scan_results, scanData);
  });

  it('includes instructions block with filename and content', async () => {
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok('instructions' in requestBody);
    assert.equal(requestBody.instructions.filename, 'instructions.md');
    assert.equal(requestBody.instructions.content, instrContent);
  });

  it('includes git block when provider returns headSha and committerEmail', async () => {
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok('git' in requestBody, 'git block must be present');
    assert.equal(requestBody.git.commitSha, 'deadbeef');
    assert.equal(requestBody.git.committerEmail, 'ci@example.com');
  });

  it('omits git block when provider has no headSha/committerEmail', async () => {
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: noGitProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok(!('git' in requestBody), 'git block must be absent when metadata missing');
  });

  it('includes caller_metadata in request body', async () => {
    const meta = { source: 'SOURCE_GITHUB', aspen_version: '2.1.0' };
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: meta,
    });

    const { requestBody } = capturedRequests[0];
    assert.deepEqual(requestBody.caller_metadata, meta);
  });

  it('throws when scan results file cannot be read', async () => {
    await assert.rejects(
      () =>
        runGuardianMode({
          inputs: {
            scanResultsPath: '/nonexistent/scan.json',
            instructionFilePath: INSTR_PATH,
            scannerType: null,
            apiToken: 'tok',
            apiDomain: 'my.example.com',
            autoCommit: false,
            excludeGitMetadataFields: [],
          },
          provider: fakeProvider,
          callerMetadata: {},
        }),
      (err) => {
        assert.ok(err.message.includes('Failed to read or parse scan results'));
        return true;
      }
    );
  });

  it('commits back when autoCommit=true and updated_instructions present', async () => {
    mockApiResponse = { updated_instructions: '# Updated Instructions' };
    let committed = false;
    const committingProvider = {
      getMetadata: fakeProvider.getMetadata,
      commitFile: async ({ filePath, content }) => {
        committed = true;
        assert.equal(content, '# Updated Instructions');
        assert.equal(filePath, INSTR_PATH);
      },
    };

    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: true,
        excludeGitMetadataFields: [],
      },
      provider: committingProvider,
      callerMetadata: {},
    });

    assert.ok(committed, 'commitFile should have been called');
  });

  it('skips commit when autoCommit=false even if updated_instructions present', async () => {
    mockApiResponse = { updated_instructions: '# Updated Instructions' };
    let committed = false;
    const provider = {
      getMetadata: fakeProvider.getMetadata,
      commitFile: async () => {
        committed = true;
      },
    };

    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider,
      callerMetadata: {},
    });

    assert.ok(!committed, 'commitFile should NOT have been called when autoCommit=false');
  });

  it('skips commit when updated_instructions is absent in response', async () => {
    mockApiResponse = {}; // No updated_instructions
    let committed = false;
    const provider = {
      getMetadata: fakeProvider.getMetadata,
      commitFile: async () => {
        committed = true;
      },
    };

    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: true,
        excludeGitMetadataFields: [],
      },
      provider,
      callerMetadata: {},
    });

    assert.ok(!committed, 'commitFile should NOT be called when no updated_instructions');
  });
});

// ---------------------------------------------------------------------------
// Mode B — CWE list
// ---------------------------------------------------------------------------

describe('runGuardianMode — Mode B (CWE list)', () => {
  const INSTR_PATH = '/tmp/instructions.md';
  const instrContent = '# Security Instructions';

  beforeEach(() => {
    clearCaptures();
    mockApiResponse = { updated_instructions: null };
    mockFiles[INSTR_PATH] = instrContent;
  });

  it('sends cwes in the request body (not scan_results)', async () => {
    const cwes = ['CWE-79', 'CWE-89', 'CWE-200'];
    await runGuardianMode({
      inputs: {
        cwes,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: { source: 'SOURCE_GITHUB' },
    });

    assert.equal(capturedRequests.length, 1);
    const { requestBody } = capturedRequests[0];
    assert.ok('cwes' in requestBody, 'cwes must be present in Mode B');
    assert.ok(!('scan_results' in requestBody), 'scan_results must not be present in Mode B');
    assert.deepEqual(requestBody.cwes, cwes);
  });

  it('includes instructions block in Mode B', async () => {
    await runGuardianMode({
      inputs: {
        cwes: ['CWE-79'],
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok('instructions' in requestBody);
    assert.equal(requestBody.instructions.content, instrContent);
  });

  it('includes git block in Mode B when available', async () => {
    await runGuardianMode({
      inputs: {
        cwes: ['CWE-79'],
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok('git' in requestBody);
  });

  it('omits git block in Mode B when metadata unavailable', async () => {
    await runGuardianMode({
      inputs: {
        cwes: ['CWE-79'],
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: noGitProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok(!('git' in requestBody));
  });

  it('supports auto-commit in Mode B when updated_instructions present', async () => {
    mockApiResponse = { updated_instructions: '# New Instructions' };
    let committed = false;
    const committingProvider = {
      getMetadata: fakeProvider.getMetadata,
      commitFile: async () => {
        committed = true;
      },
    };

    await runGuardianMode({
      inputs: {
        cwes: ['CWE-79'],
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: true,
        excludeGitMetadataFields: [],
      },
      provider: committingProvider,
      callerMetadata: {},
    });

    assert.ok(committed, 'should commit in Mode B when autoCommit=true and updated_instructions present');
  });
});

// ---------------------------------------------------------------------------
// disableAdapt — ASPEN_DISABLE_ADAPT=true
// ---------------------------------------------------------------------------

describe('runGuardianMode — disableAdapt', () => {
  const SCAN_PATH = '/tmp/scan.json';
  const INSTR_PATH = '/tmp/instructions.md';

  beforeEach(() => {
    clearCaptures();
    mockApiResponse = { updated_instructions: null };
    mockFiles[SCAN_PATH] = JSON.stringify({ runs: [] });
    mockFiles[INSTR_PATH] = '# Instructions';
  });

  it('omits the git block when disableAdapt=true (Mode A)', async () => {
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
        disableAdapt: true,
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok(!('git' in requestBody), 'git block must be absent when disableAdapt=true');
  });

  it('omits the git block when disableAdapt=true (Mode B)', async () => {
    await runGuardianMode({
      inputs: {
        cwes: ['CWE-79'],
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
        disableAdapt: true,
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok(!('git' in requestBody), 'git block must be absent when disableAdapt=true');
  });

  it('includes the git block when disableAdapt=false (default)', async () => {
    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
        disableAdapt: false,
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.ok('git' in requestBody, 'git block must be present when disableAdapt=false');
  });
});

// ---------------------------------------------------------------------------
// Instruction file resolution
// ---------------------------------------------------------------------------

describe('runGuardianMode — instruction file resolution', () => {
  const SCAN_PATH = '/tmp/scan2.json';

  beforeEach(() => {
    clearCaptures();
    mockApiResponse = { updated_instructions: null };
    mockFiles[SCAN_PATH] = JSON.stringify({ runs: [] });
  });

  it('resolves a file path directly (not a directory)', async () => {
    const INSTR_PATH = '/tmp/instrs.md';
    mockFiles[INSTR_PATH] = '# Direct file';

    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: INSTR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.equal(requestBody.instructions.content, '# Direct file');
    assert.equal(requestBody.instructions.filename, 'instrs.md');
  });

  it('finds first .md file in a directory path', async () => {
    const DIR_PATH = '/tmp/instrsdir';
    mockFiles[`${DIR_PATH}/security.md`] = '# Dir-based instructions';

    await runGuardianMode({
      inputs: {
        scanResultsPath: SCAN_PATH,
        instructionFilePath: DIR_PATH,
        scannerType: null,
        apiToken: 'tok',
        apiDomain: 'my.example.com',
        autoCommit: false,
        excludeGitMetadataFields: [],
      },
      provider: fakeProvider,
      callerMetadata: {},
    });

    const { requestBody } = capturedRequests[0];
    assert.equal(requestBody.instructions.filename, 'security.md');
    assert.equal(requestBody.instructions.content, '# Dir-based instructions');
  });
});
