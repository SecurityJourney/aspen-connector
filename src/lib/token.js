/**
 * Rewrites "api.securityjourney.com" → "my.securityjourney.com".
 * Domains that don't start with "api." are returned unchanged.
 */
export function deriveDirectDomain(apiDomain) {
  return apiDomain.replace(/^api\./, 'my.');
}

export async function exchangeTokenForJwt(apiDomain, apiToken) {
  console.log(`[aspen-connector] Exchanging API token for JWT...`);

  const response = await fetch(`https://${apiDomain}/svc/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject_token: apiToken,
      subject_token_type: 'urn:securityjourney:api:token',
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed with HTTP ${response.status}: ${body}`);
  }

  const data = await response.json();

  if (!data.access_token) {
    throw new Error(`Token exchange response missing access_token`);
  }

  console.log('[aspen-connector] JWT obtained');
  return data.access_token;
}
