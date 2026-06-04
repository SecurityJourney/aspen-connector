import { readFileSync, statSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { exchangeTokenForJwt, deriveDirectDomain } from '../lib/token.js';
import { callApiWithStreaming } from '../lib/stream.js';
import { buildGitBlock } from '../lib/git.js';
import { getInput } from '../inputs.js';

/**
 * Mode A: scan results + instruction file → Guardian AI (streaming) → commit-back + CWE recording
 * Mode B: CWE list + instruction file → Guardian AI (streaming) → commit-back + CWE recording
 *
 * Provide either `scanResultsPath` (Mode A) or `cwes` (Mode B) — not both.
 *
 * CWE recording happens on the Aspen backend when git metadata is present and the tenant
 * has CWE recording enabled. The package signals this by including the `git` block in the request.
 */
export async function runGuardianMode({ inputs, provider, callerMetadata }) {
  const {
    cwes,             // Mode B: pre-parsed CWE array (mutually exclusive with scanResultsPath)
    scanResultsPath,  // Mode A: path to scan results JSON file
    instructionFilePath,
    scannerType,
    apiToken,
    apiDomain,
    autoCommit,
    excludeGitMetadataFields,
    disableAdapt,     // when true, omit the git block → Guardian AI only, no CWE recording
  } = inputs;

  // SSE endpoints cannot route through the API gateway — derive the direct backend domain
  const directDomain = deriveDirectDomain(apiDomain);

  // Exchange token for JWT
  const jwtToken = await exchangeTokenForJwt(directDomain, apiToken);

  // Build the scan payload — CWE list (Mode B) or scan results file (Mode A)
  let scanPayload;
  if (cwes) {
    console.log(`[aspen-connector] Mode B: updating instructions from ${cwes.length} CWE(s): ${cwes.join(', ')}`);
    scanPayload = { cwes };
  } else {
    console.log(`[aspen-connector] Reading scan results from: ${scanResultsPath}`);
    let scanResults;
    try {
      scanResults = JSON.parse(readFileSync(scanResultsPath, 'utf8'));
    } catch (e) {
      throw new Error(`Failed to read or parse scan results from ${scanResultsPath}: ${e.message}`);
    }
    scanPayload = { scan_results: scanResults };
  }

  // Resolve instruction file (accepts file path or directory)
  const instructionFile = resolveInstructionFile(instructionFilePath);
  console.log(`[aspen-connector] Reading instruction file: ${instructionFile}`);
  let instructionContent;
  try {
    instructionContent = readFileSync(instructionFile, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read instruction file ${instructionFile}: ${e.message}`);
  }

  // Collect git metadata from the platform provider
  const metadata = await provider.getMetadata();

  // Build the `git` block — presence of this block is what enables CWE recording on the backend.
  // Omitted when ASPEN_DISABLE_ADAPT=true (Guardian AI only run) or when git metadata is unavailable.
  const git = disableAdapt ? null : buildGitBlock(metadata, excludeGitMetadataFields);
  if (disableAdapt) {
    console.log('[aspen-connector] Adapt disabled — CWE recording will be skipped');
  } else if (!git) {
    console.log('[aspen-connector] Warning: no git metadata could be collected — CWE recording will be skipped');
  }

  // Build request body
  const requestBody = {
    ...scanPayload,
    instructions: {
      filename: basename(instructionFile),
      content: instructionContent,
    },
    caller_metadata: callerMetadata,
    ...(git ? { git } : {}),
  };

  // Call Guardian AI directly (SSE bypasses the API gateway)
  const apiUrl = `https://${directDomain}/svc/guardian`;
  console.log('[aspen-connector] Calling Guardian API...');

  const apiResponse = await callApiWithStreaming(apiUrl, scannerType, jwtToken, requestBody);

  // Commit back if we received updated instructions
  if (apiResponse.updated_instructions) {
    if (autoCommit) {
      const message = buildCommitMessage(metadata.prNumber);

      console.log('[aspen-connector] Committing updated instructions...');
      await provider.commitFile({
        filePath: instructionFile,
        content: apiResponse.updated_instructions,
        message,
      });
    } else {
      console.log('[aspen-connector] auto_commit is disabled — skipping commit');
    }
  } else {
    console.log('[aspen-connector] No updated instructions in response, nothing to commit');
  }

  return apiResponse;
}

/**
 * Resolves a file or directory path to an instruction file.
 * If a directory is given, returns the first .md file found.
 */
function resolveInstructionFile(filePath) {
  const stats = statSync(filePath);
  if (!stats.isDirectory()) return filePath;

  const files = readdirSync(filePath);
  const mdFile = files.find((f) => /\.md$/i.test(f));
  if (!mdFile) throw new Error(`No markdown file found in directory: ${filePath}`);
  return join(filePath, mdFile);
}

/**
 * Builds the commit message for the instruction file update.
 * Uses ASPEN_COMMIT_MESSAGE if set, otherwise falls back to the default.
 * Always ensures [skip ci] is present to prevent pipeline loops.
 */
function buildCommitMessage(prNumber) {
  const custom = getInput('commit_message');
  let message = custom || (prNumber
    ? `Update instructions via Guardian scan\n\nUpdated based on security scan results from MR/PR #${prNumber}`
    : 'Update instructions via Guardian scan');

  if (!message.includes('[skip ci]')) {
    message += ' [skip ci]';
  }

  return message;
}

