/**
 * Tests for src/lib/token.js
 *
 * Covers:
 * - deriveDirectDomain() — pure function, no mocking needed
 * - exchangeTokenForJwt() — mocks global fetch
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDirectDomain, exchangeTokenForJwt } from '../src/lib/token.js';

// ---------------------------------------------------------------------------
// deriveDirectDomain
// ---------------------------------------------------------------------------

describe('deriveDirectDomain', () => {
  it('converts api.securityjourney.com to my.securityjourney.com', () => {
    assert.equal(deriveDirectDomain('api.securityjourney.com'), 'my.securityjourney.com');
  });

  it('converts api.securityjourney.dev to my.securityjourney.dev', () => {
    assert.equal(deriveDirectDomain('api.securityjourney.dev'), 'my.securityjourney.dev');
  });

  it('returns the domain unchanged when it does not start with api.', () => {
    assert.equal(deriveDirectDomain('my.securityjourney.com'), 'my.securityjourney.com');
  });

  it('returns arbitrary non-api. domains unchanged', () => {
    assert.equal(deriveDirectDomain('custom.example.com'), 'custom.example.com');
  });

  it('does not replace api. in the middle of the domain', () => {
    assert.equal(deriveDirectDomain('not-api.example.com'), 'not-api.example.com');
  });
});

// ---------------------------------------------------------------------------
// exchangeTokenForJwt
// ---------------------------------------------------------------------------

describe('exchangeTokenForJwt', () => {
  let fetchMock;

  afterEach(() => {
    fetchMock?.mock.restore();
  });

  it('returns access_token on a successful exchange', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ access_token: 'jwt-abc123', expires_in: 3600 }),
      text: async () => '',
    }));

    const token = await exchangeTokenForJwt('my.securityjourney.com', 'raw-api-key');
    assert.equal(token, 'jwt-abc123');
  });

  it('POSTs to the correct auth endpoint', async () => {
    let capturedUrl;
    fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ access_token: 'jwt', expires_in: 3600 }),
        text: async () => '',
      };
    });

    await exchangeTokenForJwt('my.securityjourney.com', 'raw-api-key');
    assert.equal(capturedUrl, 'https://my.securityjourney.com/svc/auth/token');
  });

  it('sends the api token as subject_token in the request body', async () => {
    let capturedBody;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ access_token: 'jwt', expires_in: 3600 }),
        text: async () => '',
      };
    });

    await exchangeTokenForJwt('my.securityjourney.com', 'my-api-key');
    assert.equal(capturedBody.subject_token, 'my-api-key');
    assert.equal(capturedBody.grant_type, 'urn:ietf:params:oauth:grant-type:token-exchange');
  });

  it('throws a descriptive error on HTTP failure', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }));

    await assert.rejects(
      () => exchangeTokenForJwt('my.securityjourney.com', 'bad-key'),
      (err) => {
        assert.ok(err.message.includes('401'));
        assert.ok(err.message.includes('Unauthorized'));
        return true;
      }
    );
  });

  it('throws when access_token is missing from the response', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ expires_in: 3600 }), // no access_token
      text: async () => '',
    }));

    await assert.rejects(
      () => exchangeTokenForJwt('my.securityjourney.com', 'api-key'),
      (err) => {
        assert.ok(err.message.includes('access_token'));
        return true;
      }
    );
  });

  it('throws a network error when fetch rejects', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    await assert.rejects(
      () => exchangeTokenForJwt('my.securityjourney.com', 'api-key'),
      /ECONNREFUSED/
    );
  });
});
