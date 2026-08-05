import { readFileSync } from 'fs';
import { buildGitBlock } from '../lib/git.js';
import { deriveDirectDomain, exchangeTokenForJwt } from '../lib/token.js';

/**
 * Mode D: scan results only → extract CWEs + record them.
 * No instruction file, no commit-back, no AI rewrite.
 *
 * Requires a JWT rather than the raw API key, so apiDomain goes through the
 * same api.->my. derivation and token exchange as the other JWT-based modes.
 */
export async function runExtractMode({ inputs, provider, callerMetadata }) {
  const {
    scanResultsPath,
    scannerType,
    apiToken,
    apiDomain,
    excludeGitMetadataFields,
  } = inputs;

  // Read scan results
  console.log(
    `[aspen-connector] Reading scan results from: ${scanResultsPath}`,
  );
  let scanResults;
  try {
    scanResults = JSON.parse(readFileSync(scanResultsPath, 'utf8'));
  } catch (e) {
    throw new Error(
      `Failed to read or parse scan results from ${scanResultsPath}: ${e.message}`,
    );
  }

  // Collect git metadata for CWE recording
  const metadata = await provider.getMetadata();
  const git = buildGitBlock(metadata, excludeGitMetadataFields);
  if (!git) {
    console.log(
      '[aspen-connector] Warning: no git metadata could be collected — CWEs will be extracted but not recorded',
    );
  }

  // Build request body
  const requestBody = {
    scan_results: scanResults,
    caller_metadata: callerMetadata,
    ...(git ? { git } : {}),
  };

  const directDomain = deriveDirectDomain(apiDomain);
  const jwtToken = await exchangeTokenForJwt(directDomain, apiToken);
  const apiUrl = `https://${directDomain}/svc/guardian/scan/extract-cwes`;
  console.log('[aspen-connector] Extracting CWEs from scan results...');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwtToken}`,
  };
  if (scannerType) headers['X-Scanner-Type'] = scannerType;

  let response;
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    throw new Error(`Network error reaching ${directDomain}: ${e.message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `extract-cwes request failed with HTTP ${response.status}: ${body}`,
    );
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('extract-cwes response was not valid JSON');
  }

  console.log(
    `[aspen-connector] Extracted ${(result.cwes ?? []).length} CWE(s): ${(result.cwes ?? []).join(', ') || 'none'}`,
  );
  if (result.recorded) {
    console.log('[aspen-connector] CWEs recorded successfully');
  } else if (git) {
    console.log(
      '[aspen-connector] CWEs were not recorded (tenant setting or backend error)',
    );
  }

  return result;
}
