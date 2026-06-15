/**
 * Tests for src/lib/stream.js
 *
 * Covers:
 * - Happy path: processing → heartbeat → complete → returns data
 * - Error event → throws
 * - Timeout event → throws
 * - Malformed JSON in data line → warns and continues (does not crash)
 * - Stream ends without complete event → throws
 * - HTTP error response → throws
 * - X-Scanner-Type header only sent when scannerType is provided
 */

import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callApiWithStreaming } from '../src/lib/stream.js';

// ---------------------------------------------------------------------------
// Helpers — build a mock SSE response body from event strings
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function makeBody(chunks) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) {
        yield encoder.encode(chunk);
      }
    },
  };
}

function sseEvent(type, data) {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function mockResponse(chunks, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => 'error body',
    body: makeBody(chunks),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('callApiWithStreaming', () => {
  let fetchMock;

  afterEach(() => {
    fetchMock?.mock.restore();
  });

  it('returns updated_instructions from a complete event', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      mockResponse([
        sseEvent('processing', { scanner_type: 'snyk' }),
        sseEvent('complete', {
          elapsed_seconds: 3,
          data: { updated_instructions: 'new content' },
        }),
      ]),
    );

    const result = await callApiWithStreaming(
      'https://my.example.com',
      null,
      'jwt',
      {},
    );
    assert.equal(result.updated_instructions, 'new content');
  });

  it('handles heartbeat events before completing', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      mockResponse([
        sseEvent('processing', { scanner_type: 'snyk' }),
        sseEvent('heartbeat', { elapsed_seconds: 10 }),
        sseEvent('heartbeat', { elapsed_seconds: 20 }),
        sseEvent('complete', {
          elapsed_seconds: 25,
          data: { updated_instructions: 'done' },
        }),
      ]),
    );

    const result = await callApiWithStreaming(
      'https://my.example.com',
      null,
      'jwt',
      {},
    );
    assert.equal(result.updated_instructions, 'done');
  });

  it('throws on an error event', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      mockResponse([
        sseEvent('processing', { scanner_type: 'snyk' }),
        sseEvent('error', { error: 'something went wrong' }),
      ]),
    );

    await assert.rejects(
      () => callApiWithStreaming('https://my.example.com', null, 'jwt', {}),
      /something went wrong/,
    );
  });

  it('throws on a timeout event', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      mockResponse([
        sseEvent('processing', { scanner_type: 'snyk' }),
        sseEvent('timeout', { message: 'scan timed out' }),
      ]),
    );

    await assert.rejects(
      () => callApiWithStreaming('https://my.example.com', null, 'jwt', {}),
      /scan timed out/,
    );
  });

  it('throws when stream ends without a complete event', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      mockResponse([
        sseEvent('processing', { scanner_type: 'snyk' }),
        // stream ends here — no complete event
      ]),
    );

    await assert.rejects(
      () => callApiWithStreaming('https://my.example.com', null, 'jwt', {}),
      /SSE stream ended without receiving a completion event/,
    );
  });

  it('throws on HTTP error response', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
      body: makeBody([]),
    }));

    await assert.rejects(
      () => callApiWithStreaming('https://my.example.com', null, 'jwt', {}),
      (err) => {
        assert.ok(err.message.includes('403'));
        assert.ok(err.message.includes('Forbidden'));
        return true;
      },
    );
  });

  it('skips malformed JSON data lines without crashing', async () => {
    fetchMock = mock.method(globalThis, 'fetch', async () =>
      mockResponse([
        'event: processing\ndata: {bad json}\n\n',
        sseEvent('complete', {
          elapsed_seconds: 1,
          data: { updated_instructions: 'ok' },
        }),
      ]),
    );

    // Should not throw — malformed line is skipped, complete event is processed
    const result = await callApiWithStreaming(
      'https://my.example.com',
      null,
      'jwt',
      {},
    );
    assert.equal(result.updated_instructions, 'ok');
  });

  it('sends X-Scanner-Type header when scannerType is provided', async () => {
    let capturedHeaders;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedHeaders = opts.headers;
      return mockResponse([
        sseEvent('complete', {
          elapsed_seconds: 1,
          data: { updated_instructions: 'x' },
        }),
      ]);
    });

    await callApiWithStreaming('https://my.example.com', 'snyk', 'jwt', {});
    assert.equal(capturedHeaders['X-Scanner-Type'], 'snyk');
  });

  it('omits X-Scanner-Type header when scannerType is null', async () => {
    let capturedHeaders;
    fetchMock = mock.method(globalThis, 'fetch', async (_url, opts) => {
      capturedHeaders = opts.headers;
      return mockResponse([
        sseEvent('complete', {
          elapsed_seconds: 1,
          data: { updated_instructions: 'x' },
        }),
      ]);
    });

    await callApiWithStreaming('https://my.example.com', null, 'jwt', {});
    assert.equal(capturedHeaders['X-Scanner-Type'], undefined);
  });

  it('POSTs to the /scan/stream path', async () => {
    let capturedUrl;
    fetchMock = mock.method(globalThis, 'fetch', async (url) => {
      capturedUrl = url;
      return mockResponse([
        sseEvent('complete', {
          elapsed_seconds: 1,
          data: { updated_instructions: 'x' },
        }),
      ]);
    });

    await callApiWithStreaming('https://my.example.com', null, 'jwt', {});
    assert.equal(capturedUrl, 'https://my.example.com/scan/stream');
  });
});
