import { assertSafeUrl } from './security.js';
import { logRequest } from './utils.js';
import { oauthTokens } from './state.js';
import { DEFAULT_TIMEOUT } from './constants.js';

// OAuth 2.0 client_credentials (RFC 6749 §4.4).
// Tokens are memory-only (persistence lands in 1.4.0 with full state persistence)
// and keyed by token_url|client_id|scope so two APIs sharing an auth server reuse one token.
const REFRESH_MARGIN_MS = 60_000; // refresh this long before expiry so Claude never sees a stale token
const DEFAULT_EXPIRES_IN = 3600;  // per RFC, expires_in is optional — assume 1h when the server omits it

function tokenCacheKey(auth) {
  return `${auth.token_url}|${auth.client_id}|${auth.scope || ''}`;
}

export function invalidateOAuthToken(auth) {
  oauthTokens.delete(tokenCacheKey(auth));
}

export async function getOAuthToken(auth, { fetchFn = fetch, timeout = DEFAULT_TIMEOUT } = {}) {
  for (const field of ['token_url', 'client_id', 'client_secret']) {
    if (!auth[field]) {
      throw new Error(
        `OAuth config is missing "${field}".\n\n` +
        `client_credentials auth needs: token_url, client_id, client_secret (optional: scope).\n` +
        `Set them via env vars referenced in blobfish.json/registry, or call:\n` +
        `set_api_auth(name, { "type": "oauth2", "token_url": "...", "client_id": "...", "client_secret": "..." })`
      );
    }
  }

  const key = tokenCacheKey(auth);
  const cached = oauthTokens.get(key);
  if (cached?.token && Date.now() < cached.expiresAt - REFRESH_MARGIN_MS) return cached.token;
  if (cached?.pending) return cached.pending; // single-flight: concurrent calls share one token request

  const pending = fetchToken(auth, fetchFn, timeout)
    .then(({ token, expiresAt }) => { oauthTokens.set(key, { token, expiresAt }); return token; })
    .catch((err) => { oauthTokens.delete(key); throw err; });
  oauthTokens.set(key, { ...cached, pending });
  return pending;
}

async function fetchToken(auth, fetchFn, timeout) {
  await assertSafeUrl(auth.token_url); // SEC-1: token endpoint goes through the same SSRF gate

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (auth.scope) body.set('scope', auth.scope);
  if (auth.audience) body.set('audience', auth.audience);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' };
  if (auth.client_auth === 'basic') {
    headers['Authorization'] = `Basic ${Buffer.from(`${auth.client_id}:${auth.client_secret}`).toString('base64')}`;
  } else {
    body.set('client_id', auth.client_id);
    body.set('client_secret', auth.client_secret);
  }

  const t0 = Date.now();
  const res = await fetchFn(auth.token_url, {
    method: 'POST', headers, body: body.toString(), signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  logRequest({ method: 'POST', url: auth.token_url, status: res.status, ms: Date.now() - t0, oauth: true });

  if (!res.ok || !data?.access_token) {
    const detail = data?.error_description || data?.error || (typeof text === 'string' ? text.slice(0, 200) : '');
    throw new Error(
      `OAuth token request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}.\n\n` +
      `Check that client_id and client_secret are valid for this token_url, and that the app ` +
      `is allowed to use the client_credentials grant. Some providers also require a "scope" ` +
      `or "audience" value — pass them via set_api_auth or the auth config.`
    );
  }

  const expiresIn = Number(data.expires_in) || DEFAULT_EXPIRES_IN;
  return { token: data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
}