/**
 * Training enforcement mode:
 * checks the committer's training-assignment status and fails CI when blocked.
 */
export async function runTrainingMode({ inputs, callerMetadata }) {
  const {
    apiToken,
    apiDomain,
    trainingStatusPath,
    trainingRequiredAssignments,
    trainingBlockingStatuses,
    trainingFailOpen,
    metadata,
  } = inputs;

  const subject = {
    ...(metadata.committerEmail
      ? { committerEmail: metadata.committerEmail }
      : {}),
    ...(metadata.username ? { username: metadata.username } : {}),
  };

  if (!subject.committerEmail && !subject.username) {
    return handleFailOpen(
      trainingFailOpen,
      'No committer identity available (committerEmail/username) to evaluate training compliance',
    );
  }

  const endpoint = `https://${apiDomain}${normalizePath(trainingStatusPath)}`;
  const payload = {
    subject,
    git: {
      ...(metadata.headSha ? { commitSha: metadata.headSha } : {}),
      ...(metadata.repo ? { repo: metadata.repo } : {}),
      ...(metadata.prNumber ? { prNumber: metadata.prNumber } : {}),
      ...(metadata.branch ? { branch: metadata.branch } : {}),
    },
    requiredAssignments: trainingRequiredAssignments,
    caller_metadata: callerMetadata,
  };

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return handleFailOpen(
      trainingFailOpen,
      `Network error reaching training endpoint: ${e.message}`,
    );
  }

  if (!response.ok) {
    const body = await response.text();
    return handleFailOpen(
      trainingFailOpen,
      `Training status request failed with HTTP ${response.status}: ${body}`,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return handleFailOpen(
      trainingFailOpen,
      'Training status response was not valid JSON',
    );
  }

  const evaluation = evaluateTrainingResponse(data, trainingBlockingStatuses);
  if (!evaluation.allowed) {
    throw new Error(`Training gate failed: ${evaluation.reason}`);
  }

  console.log('[aspen-connector] Training gate passed');
  return data;
}

function evaluateTrainingResponse(data, trainingBlockingStatuses) {
  if (typeof data.compliant === 'boolean') {
    if (data.compliant) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        data.reason || formatBlockingAssignments(data.blockingAssignments),
    };
  }

  const blockingAssignments = Array.isArray(data.blockingAssignments)
    ? data.blockingAssignments
    : [];
  if (blockingAssignments.length > 0) {
    return {
      allowed: false,
      reason: formatBlockingAssignments(blockingAssignments),
    };
  }

  if (typeof data.status === 'string') {
    const normalized = data.status.trim().toLowerCase();
    const blocked = new Set(
      (trainingBlockingStatuses ?? []).map((status) =>
        status.trim().toLowerCase(),
      ),
    );
    if (blocked.has(normalized)) {
      return {
        allowed: false,
        reason: data.reason || `status=${normalized}`,
      };
    }
    return { allowed: true };
  }

  throw new Error(
    'Training status response missing expected fields. Include compliant (boolean), blockingAssignments (array), or status (string).',
  );
}

function formatBlockingAssignments(blockingAssignments) {
  if (!Array.isArray(blockingAssignments) || blockingAssignments.length === 0) {
    return 'compliant=false';
  }

  const summary = blockingAssignments
    .slice(0, 3)
    .map((item) => item.title || item.assignmentId || item.id || 'assignment')
    .join(', ');

  const extra =
    blockingAssignments.length > 3
      ? ` (+${blockingAssignments.length - 3} more)`
      : '';

  return `blocking assignments: ${summary}${extra}`;
}

function normalizePath(path) {
  if (!path) return '/integrations/training/assignment-status';
  return path.startsWith('/') ? path : `/${path}`;
}

function handleFailOpen(trainingFailOpen, reason) {
  if (!trainingFailOpen) {
    throw new Error(reason);
  }
  console.warn(`[aspen-connector] Training gate fail-open: ${reason}`);
  return { compliant: true, failOpen: true, reason };
}
