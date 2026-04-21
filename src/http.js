import { assertSafeUrl } from './security.js';
import { buildAuthHeaders, logRequest, sleep } from './utils.js';
import { updateRateLimit } from './ratelimit.js';
import { DEFAULT_TIMEOUT, DEFAULT_RETRIES, MAX_RESP_SIZE } from './constants.js';

// SEC-9: Retry-After capped at 60s via Math.min
export async function withRetry(fn, retries = DEFAULT_RETRIES, delay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn();
      if (result.status === 429 && i < retries) {
        const retryAfter = parseInt(result.headers?.['retry-after'] ?? '5');
        const waitMs = retryAfter > 1000 ? retryAfter : retryAfter * 1000;
        console.error(`[Blobfish] 429 — waiting ${Math.ceil(Math.min(waitMs, 60000) / 1000)}s before retry...`);
        await sleep(Math.min(waitMs, 60000)); continue;
      }
      if (result.status >= 500 && i < retries) { await sleep(delay * 2 ** i); continue; }
      return result;
    } catch (err) { if (i === retries) throw err; await sleep(delay * 2 ** i); }
  }
}

export async function executeRequest(baseUrl, method, pathTemplate, operation, args, auth, timeout = DEFAULT_TIMEOUT, apiName = null) {
  let url = baseUrl + pathTemplate;
  const headers = buildAuthHeaders(auth);
  const queryParams = new URLSearchParams();
  for (const p of (operation.parameters || [])) {
    const val = args[p.name]; if (val == null) continue;
    if (p.in === 'path') url = url.replace(`{${p.name}}`, encodeURIComponent(String(val)));
    else if (p.in === 'query') queryParams.set(p.name, String(val));
    else if (p.in === 'header') headers[p.name] = String(val);
  }
  const qs = queryParams.toString(); if (qs) url += `?${qs}`;
  await assertSafeUrl(url); // SEC-1: SSRF check on final URL
  const init = { method: method.toUpperCase(), headers, signal: AbortSignal.timeout(timeout) };
  if (args.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(args.body); }
  const t0 = Date.now();
  const res = await fetch(url, init);
  const ms = Date.now() - t0;
  const contentLength = parseInt(res.headers.get('content-length') || '0');
  if (contentLength > MAX_RESP_SIZE) throw new Error(`Response too large (${(contentLength / 1024 / 1024).toFixed(1)}MB, max ${MAX_RESP_SIZE / 1024 / 1024}MB)`);
  const text = await res.text();
  if (text.length > MAX_RESP_SIZE) throw new Error(`Response body too large`);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const resHeaders = {};
  for (const [k, v] of res.headers.entries()) resHeaders[k.toLowerCase()] = v;
  logRequest({ method: method.toUpperCase(), url, status: res.status, ms });
  if (apiName) updateRateLimit(apiName, resHeaders);
  return { status: res.status, ok: res.ok, data, headers: resHeaders };
}
