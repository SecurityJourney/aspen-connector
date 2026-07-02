#!/usr/bin/env node

import { detectProvider, detectSource } from './providers/index.js';
import {
  getInput,
  getRequiredInput,
  parseBoolean,
  parseJsonArray,
  parseExcludeFields,
} from './inputs.js';
import { runGuardianMode } from './modes/guardian.js';
import { runAdaptMode } from './modes/adapt.js';
import { runExtractMode } from './modes/extract.js';
import { runTrainingMode } from './modes/training.js';
import { version } from './version.js';

async function run() {
  try {
    const provider = detectProvider();
    const source = detectSource();

    const apiToken = getRequiredInput('api_token');
    const apiDomain = getInput('api_domain') || 'api.securityjourney.com';

    const callerMetadata = { source, aspen_version: version };

    const cwesRaw = getInput('cwes');
    const scanResultsPath = getInput('scan_results_path');
    const instructionFilePath = getInput('instruction_file_path');

    // 'all' suppresses the entire git block (Guardian AI only, no CWE recording).
    // A string[] excludes specific fields from the git block.
    const excludeParsed = parseExcludeFields(
      getInput('exclude_git_metadata_fields'),
    );
    const disableAdapt = excludeParsed === 'all';
    const excludeGitMetadataFields = disableAdapt ? [] : excludeParsed;

    const enforceTraining = parseBoolean(getInput('enforce_training'), false);
    const trainingStatusPath =
      getInput('training_status_path') ||
      '/integrations/training/assignment-status';
    const trainingRequiredAssignments = parseJsonArray(
      getInput('training_required_assignments'),
      'training_required_assignments',
    );
    const trainingBlockingStatusesInput = getInput(
      'training_blocking_statuses',
    );
    const trainingBlockingStatuses = trainingBlockingStatusesInput
      ? parseJsonArray(
          trainingBlockingStatusesInput,
          'training_blocking_statuses',
        )
      : ['incomplete', 'overdue', 'non_compliant', 'failed'];
    const trainingFailOpen = parseBoolean(
      getInput('training_fail_open'),
      false,
    );

    if (enforceTraining) {
      const metadata = await provider.getMetadata();
      await runTrainingMode({
        inputs: {
          apiToken,
          apiDomain,
          trainingStatusPath,
          trainingRequiredAssignments,
          trainingBlockingStatuses,
          trainingFailOpen,
          metadata,
        },
        callerMetadata,
      });
    }

    const hasModeInputs =
      Boolean(cwesRaw) ||
      Boolean(scanResultsPath) ||
      Boolean(instructionFilePath);
    if (enforceTraining && !hasModeInputs) {
      console.log(
        '[aspen-connector] Training enforcement check completed with no additional mode selected',
      );
      return;
    }

    // ── Mode B: CWE list + instruction file → Guardian SSE (CWE-based update) ──
    if (cwesRaw && instructionFilePath) {
      const cwes = parseJsonArray(cwesRaw, 'cwes');
      if (!cwes.length)
        throw new Error('"cwes" input is an empty array — nothing to record');
      const autoCommit = parseBoolean(getInput('auto_commit'), true);

      await runGuardianMode({
        inputs: {
          cwes,
          instructionFilePath,
          scannerType: null, // not applicable for CWE-list path
          apiToken,
          apiDomain,
          autoCommit,
          excludeGitMetadataFields,
          disableAdapt,
        },
        provider,
        callerMetadata,
      });
      return;
    }

    // ── Mode C: explicit CWE list only → CWE recording (no instruction update) ──
    if (cwesRaw) {
      const cwes = parseJsonArray(cwesRaw, 'cwes');
      if (!cwes.length)
        throw new Error('"cwes" input is an empty array — nothing to record');

      const metadata = await provider.getMetadata();

      await runAdaptMode({
        inputs: {
          cwes,
          apiToken,
          apiDomain,
          excludeGitMetadataFields,
          metadata,
        },
        callerMetadata,
      });
      return;
    }

    // ── Mode A: scan results + instruction file → Guardian SSE ────────────
    if (scanResultsPath && instructionFilePath) {
      const scannerType = getInput('scanner_type') || null; // optional — backend auto-detects if omitted
      const autoCommit = parseBoolean(getInput('auto_commit'), true);

      await runGuardianMode({
        inputs: {
          scanResultsPath,
          instructionFilePath,
          scannerType,
          apiToken,
          apiDomain,
          autoCommit,
          excludeGitMetadataFields,
          disableAdapt,
        },
        provider,
        callerMetadata,
      });
      return;
    }

    // ── Mode D: scan results only → extract + record CWEs ─────────────────
    if (scanResultsPath) {
      const scannerType = getInput('scanner_type') || null;

      await runExtractMode({
        inputs: {
          scanResultsPath,
          scannerType,
          apiToken,
          apiDomain,
          excludeGitMetadataFields,
        },
        provider,
        callerMetadata,
      });
      return;
    }

    // ── No valid input combination ─────────────────────────────────────────
    throw new Error(
      'Invalid inputs. Provide one of:\n' +
        '  Mode A: ASPEN_SCAN_RESULTS_PATH + ASPEN_INSTRUCTION_FILE_PATH (ASPEN_SCANNER_TYPE optional — auto-detected)\n' +
        '  Mode B: ASPEN_CWES + ASPEN_INSTRUCTION_FILE_PATH\n' +
        '  Mode C: ASPEN_CWES\n' +
        '  Mode D: ASPEN_SCAN_RESULTS_PATH (ASPEN_SCANNER_TYPE optional — auto-detected)\n' +
        '  Mode E: ASPEN_ENFORCE_TRAINING=true (training gate only)',
    );
  } catch (err) {
    console.error(`\n[aspen-connector] Fatal: ${err.message}`);
    process.exit(1);
  }
}

run();
