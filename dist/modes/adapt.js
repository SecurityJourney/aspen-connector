/**
 * Mode C: explicit CWE list → records CWEs via the Aspen platform.
 * No instruction file update, no commit-back, no AI rewrite.
 *
 * Routes through the API gateway using the raw API key — no JWT exchange needed.
 */
export async function runAdaptMode({ inputs, callerMetadata }) {
  const { cwes, apiToken, apiDomain, excludeGitMetadataFields, metadata } =
    inputs;

  const excluded = new Set(excludeGitMetadataFields ?? []);

  if (!metadata.headSha) {
    throw new Error(
      'Could not determine git commit SHA from the CI environment',
    );
  }
  if (!metadata.committerEmail) {
    console.warn(
      '[aspen-connector] Warning: committer email not available — CWE records may not be attributed correctly',
    );
  }

  const payload = {
    cwes,
    gitHeadSha: metadata.headSha,
    gitCommitterEmail: metadata.committerEmail,
    caller_metadata: callerMetadata,
    ...(!excluded.has('repo') && metadata.repo
      ? { gitRepo: metadata.repo }
      : {}),
    ...(!excluded.has('username') && metadata.username
      ? { username: metadata.username }
      : {}),
    ...(!excluded.has('prNumber') && metadata.prNumber
      ? { prNumber: metadata.prNumber }
      : {}),
  };

  console.log(`[aspen-connector] Recording ${cwes.length} CWE(s)...`);

  let response;
  try {
    response = await fetch(`https://${apiDomain}/integrations/cwes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error(`Network error reaching ${apiDomain}: ${e.message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `CWE recording request failed with HTTP ${response.status}: ${body}`,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('CWE recording response was not valid JSON');
  }
  console.log(`[aspen-connector] CWE data submitted successfully`);
  return data;
}
