/**
 * Calls the Guardian AI scan endpoint using Server-Sent Events (streaming).
 * Handles processing, heartbeat, complete, timeout, and error events.
 * Times out after 5 minutes.
 */
export async function callApiWithStreaming(apiUrl, scannerType, jwtToken, requestBody) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log('[aspen-connector] Client-side 5-minute timeout reached, aborting request');
    controller.abort();
  }, 5 * 60 * 1000);

  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    };
    // Only send X-Scanner-Type if explicitly provided — backend auto-detects otherwise
    if (scannerType) headers['X-Scanner-Type'] = scannerType;

    const response = await fetch(`${apiUrl}/scan/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Guardian API call failed with HTTP ${response.status}: ${errorBody}`);
    }

    console.log('[aspen-connector] Connected to SSE stream, waiting for scan results...');

    let apiResponse = null;
    let lastEventType = null;
    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event:')) {
          lastEventType = line.substring(6).trim();
        } else if (line.startsWith('data:')) {
          let data;
          try {
            data = JSON.parse(line.substring(5).trim());
          } catch {
            console.warn('[aspen-connector] Warning: received malformed SSE data line, skipping');
            continue;
          }

          if (lastEventType === 'processing') {
            console.log(`[aspen-connector] Scan started (scanner: ${data.scanner_type})`);
          } else if (lastEventType === 'heartbeat') {
            console.log(`[aspen-connector] Still processing... (${Math.round(data.elapsed_seconds)}s elapsed)`);
          } else if (lastEventType === 'complete') {
            console.log(`[aspen-connector] Scan completed in ${Math.round(data.elapsed_seconds)}s`);
            apiResponse = data.data;
            break;
          } else if (lastEventType === 'timeout') {
            throw new Error(`Guardian API processing timeout: ${data.message}`);
          } else if (lastEventType === 'error') {
            throw new Error(`Guardian API error: ${data.error || data.message}`);
          }
        }
      }

      if (apiResponse) break;
    }

    if (!apiResponse) {
      throw new Error('SSE stream ended without receiving a completion event');
    }

    return apiResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

