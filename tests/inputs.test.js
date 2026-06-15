/**
 * Tests for src/inputs.js
 *
 * Covers: getInput, getRequiredInput, parseBoolean, parseJsonArray, parseExcludeFields
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getInput,
  getRequiredInput,
  parseBoolean,
  parseJsonArray,
  parseExcludeFields,
} from '../src/inputs.js';

// ---------------------------------------------------------------------------
// getInput
// ---------------------------------------------------------------------------

describe('getInput', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it('returns empty string when env var not set', () => {
    delete process.env.ASPEN_MISSING_VAR;
    assert.equal(getInput('missing_var'), '');
  });

  it('maps input name to ASPEN_* env var', () => {
    process.env.ASPEN_SCAN_RESULTS_PATH = '/some/path.json';
    assert.equal(getInput('scan_results_path'), '/some/path.json');
  });

  it('trims whitespace from env var value', () => {
    process.env.ASPEN_API_TOKEN = '  tok123  ';
    assert.equal(getInput('api_token'), 'tok123');
  });

  it('converts hyphenated names to underscores', () => {
    process.env.ASPEN_INSTRUCTION_FILE_PATH = '/instructions.md';
    assert.equal(getInput('instruction-file-path'), '/instructions.md');
  });

  it('is case-insensitive for the name', () => {
    process.env.ASPEN_API_TOKEN = 'tok';
    assert.equal(getInput('api_token'), 'tok');
  });

  it('returns empty string when env var is set to empty string', () => {
    process.env.ASPEN_EMPTY = '';
    assert.equal(getInput('empty'), '');
  });
});

// ---------------------------------------------------------------------------
// getRequiredInput
// ---------------------------------------------------------------------------

describe('getRequiredInput', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it('returns value when env var is set', () => {
    process.env.ASPEN_API_TOKEN = 'mytoken';
    assert.equal(getRequiredInput('api_token'), 'mytoken');
  });

  it('throws when env var is missing', () => {
    delete process.env.ASPEN_API_TOKEN;
    assert.throws(
      () => getRequiredInput('api_token'),
      (err) => {
        assert.ok(err.message.includes('api_token'));
        assert.ok(err.message.includes('ASPEN_API_TOKEN'));
        return true;
      },
    );
  });

  it('throws when env var is empty string', () => {
    process.env.ASPEN_API_TOKEN = '';
    assert.throws(() => getRequiredInput('api_token'));
  });

  it('throws when env var is only whitespace', () => {
    process.env.ASPEN_API_TOKEN = '   ';
    assert.throws(() => getRequiredInput('api_token'));
  });
});

// ---------------------------------------------------------------------------
// parseBoolean
// ---------------------------------------------------------------------------

describe('parseBoolean', () => {
  it('returns default true when value is empty string', () => {
    assert.equal(parseBoolean('', true), true);
  });

  it('returns default false when value is empty string and default is false', () => {
    assert.equal(parseBoolean('', false), false);
  });

  it('returns default when value is null', () => {
    assert.equal(parseBoolean(null, true), true);
    assert.equal(parseBoolean(null, false), false);
  });

  it('returns default when value is undefined', () => {
    assert.equal(parseBoolean(undefined, true), true);
  });

  it('returns false for the string "false"', () => {
    assert.equal(parseBoolean('false', true), false);
  });

  it('returns true for the string "true"', () => {
    assert.equal(parseBoolean('true', false), true);
  });

  it('returns true for any non-empty non-"false" string', () => {
    assert.equal(parseBoolean('yes', false), true);
    assert.equal(parseBoolean('1', false), true);
    assert.equal(parseBoolean('TRUE', false), true); // case-sensitive — not "false"
  });

  it('uses true as default when second arg omitted', () => {
    assert.equal(parseBoolean(''), true);
  });
});

// ---------------------------------------------------------------------------
// parseJsonArray
// ---------------------------------------------------------------------------

describe('parseJsonArray', () => {
  it('returns empty array for empty string', () => {
    assert.deepEqual(parseJsonArray('', 'cwes'), []);
  });

  it('returns empty array for null', () => {
    assert.deepEqual(parseJsonArray(null, 'cwes'), []);
  });

  it('returns empty array for "[]"', () => {
    assert.deepEqual(parseJsonArray('[]', 'cwes'), []);
  });

  it('parses a valid JSON array of strings', () => {
    assert.deepEqual(parseJsonArray('["CWE-79","CWE-89"]', 'cwes'), [
      'CWE-79',
      'CWE-89',
    ]);
  });

  it('coerces array elements to strings', () => {
    assert.deepEqual(parseJsonArray('[79, 89]', 'cwes'), ['79', '89']);
  });

  it('throws for invalid JSON', () => {
    assert.throws(
      () => parseJsonArray('not-json', 'cwes'),
      (err) => {
        assert.ok(err.message.includes('cwes'));
        return true;
      },
    );
  });

  it('throws when value is a JSON object (not array)', () => {
    assert.throws(
      () => parseJsonArray('{"key":"val"}', 'cwes'),
      (err) => {
        assert.ok(err.message.includes('cwes'));
        return true;
      },
    );
  });

  it('throws when value is a JSON string', () => {
    assert.throws(
      () => parseJsonArray('"CWE-79"', 'cwes'),
      (err) => {
        assert.ok(err.message.includes('cwes'));
        return true;
      },
    );
  });

  it('handles whitespace around the input', () => {
    assert.deepEqual(parseJsonArray('  ["CWE-79"]  ', 'cwes'), ['CWE-79']);
  });

  it('includes fieldName in error message for diagnostics', () => {
    assert.throws(
      () => parseJsonArray('{bad}', 'scanner_list'),
      (err) => {
        assert.ok(err.message.includes('scanner_list'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// parseExcludeFields
// ---------------------------------------------------------------------------

describe('parseExcludeFields', () => {
  it('returns "all" for the string "all"', () => {
    assert.equal(parseExcludeFields('all'), 'all');
  });

  it('returns "all" when value is "all" with surrounding whitespace', () => {
    assert.equal(parseExcludeFields('  all  '), 'all');
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(parseExcludeFields(''), []);
  });

  it('returns empty array for null', () => {
    assert.deepEqual(parseExcludeFields(null), []);
  });

  it('returns empty array for undefined', () => {
    assert.deepEqual(parseExcludeFields(undefined), []);
  });

  it('parses a JSON array of field names', () => {
    assert.deepEqual(parseExcludeFields('["repo","username"]'), [
      'repo',
      'username',
    ]);
  });

  it('parses a single-element array', () => {
    assert.deepEqual(parseExcludeFields('["prNumber"]'), ['prNumber']);
  });

  it('returns empty array for "[]"', () => {
    assert.deepEqual(parseExcludeFields('[]'), []);
  });

  it('throws for invalid JSON (not "all" and not a valid array)', () => {
    assert.throws(
      () => parseExcludeFields('bad-value'),
      (err) => {
        assert.ok(err.message.includes('exclude_git_metadata_fields'));
        return true;
      },
    );
  });

  it('throws when value is a JSON object rather than an array', () => {
    assert.throws(() => parseExcludeFields('{"repo":true}'));
  });
});
