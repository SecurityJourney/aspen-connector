/**
 * Gate mode: checks the committer's learner-compliance status and fails CI
 * when they're not compliant with the tenant's configured gate.
 */

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_BODY_LENGTH = 500;
const GATE_STATUS_PATH = '/integrations/learner-compliance/status';

// AssignmentStatus values that don't block the gate.
const COMPLIANT_STATUSES = new Set([
  'ASSIGNMENT_STATUS_COMPLETED',
  'ASSIGNMENT_STATUS_NOT_ASSIGNED',
]);

export async function runGateMode({ inputs, provider, callerMetadata }) {
  const { apiToken, apiDomain, failOpen, commentOnFailure, metadata } = inputs;

  if (!metadata.committerEmail) {
    return handleFailOpen(
      failOpen,
      'No committer email available (committerEmail) to evaluate the gate',
    );
  }

  const endpoint = new URL(GATE_STATUS_PATH, `https://${apiDomain}`);

  let response;
  try {
    response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        emails: [metadata.committerEmail],
        caller_metadata: callerMetadata,
      }),
    });
  } catch (e) {
    const reason =
      e.name === 'AbortError'
        ? `Gate request to ${endpoint} timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Network error reaching gate endpoint: ${e.message}`;
    return handleFailOpen(failOpen, reason);
  }

  if (!response.ok) {
    const body = truncate(await response.text());
    return handleFailOpen(
      failOpen,
      `Gate status request failed with HTTP ${response.status}: ${body}`,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return handleFailOpen(failOpen, 'Gate status response was not valid JSON');
  }

  const result = Array.isArray(data.results)
    ? (data.results.find((r) => r.email === metadata.committerEmail) ??
      data.results[0])
    : undefined;

  if (!result) {
    return handleFailOpen(
      failOpen,
      'Gate status response had no result for the committer email',
    );
  }

  // `error` means compliance couldn't be determined (e.g. unknown committer
  // email) — treat as fail-open, not as non-compliant.
  if (result.error) {
    return handleFailOpen(
      failOpen,
      `Gate could not evaluate committer: ${result.error}`,
    );
  }

  if (typeof result.compliant !== 'boolean') {
    return handleFailOpen(
      failOpen,
      'Gate status response was missing "compliant" for the committer',
    );
  }

  warnAboutNotAssignedAssignments(
    metadata.committerEmail,
    result.requiredAssignments,
  );

  if (result.compliant) {
    console.log('[aspen-connector] Gate check passed');
    return data;
  }

  const reason =
    result.reason || summarizeIncompleteAssignments(result.requiredAssignments);
  if (commentOnFailure && metadata.prNumber) {
    await postGateComment(provider, metadata.prNumber, reason);
  }
  throw new Error(`Gate check failed: ${reason}`);
}

async function postGateComment(provider, prNumber, reason) {
  try {
    await provider.commentOnPullRequest({
      prNumber,
      body: reason,
    });
  } catch (e) {
    console.warn(
      `[aspen-connector] Could not post gate comment to PR #${prNumber}: ${e.message}`,
    );
  }
}

function warnAboutNotAssignedAssignments(committerEmail, requiredAssignments) {
  const notAssigned = (requiredAssignments ?? []).filter(
    (a) => a.status === 'ASSIGNMENT_STATUS_NOT_ASSIGNED',
  );
  if (notAssigned.length === 0) return;

  const titles = notAssigned
    .map((a) => a.title || `assignment ${a.id}`)
    .join(', ');
  console.warn(
    `[aspen-connector] ::warning::Required assignment not assigned to ${committerEmail}: ${titles}`,
  );
}

function summarizeIncompleteAssignments(requiredAssignments) {
  const incomplete = (requiredAssignments ?? []).filter(
    (a) => !COMPLIANT_STATUSES.has(a.status),
  );
  if (incomplete.length === 0) return 'not compliant';

  const summary = incomplete
    .slice(0, 3)
    .map((a) => a.title || `assignment ${a.id}`)
    .join(', ');
  const extra =
    incomplete.length > 3 ? ` (+${incomplete.length - 3} more)` : '';

  return `incomplete: ${summary}${extra}`;
}

function truncate(text) {
  if (text.length <= MAX_ERROR_BODY_LENGTH) return text;
  return `${text.slice(0, MAX_ERROR_BODY_LENGTH)}... (truncated)`;
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function handleFailOpen(failOpen, reason) {
  if (!failOpen) {
    throw new Error(reason);
  }
  console.warn(`[aspen-connector] Gate check fail-open: ${reason}`);
  return { allowed: true, failOpen: true, reason };
}
