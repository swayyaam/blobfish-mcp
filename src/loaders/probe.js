import { assertSafeUrl } from '../security.js';
import { SPEC_PROBE_PATHS, MAX_SPEC_SIZE } from '../constants.js';

export async function probeSpecUrl(baseUrl) {
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
  baseUrl = baseUrl.replace(/\/$/, '');
  await assertSafeUrl(baseUrl);
  for (const p of SPEC_PROBE_PATHS) {
    try {
      const url = baseUrl + p;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.length > MAX_SPEC_SIZE) continue;
      if (text.includes('"openapi"') || text.includes('"swagger"') || text.includes('openapi:') || text.includes('swagger:')) {
        console.error(`[Blobfish] Found spec at ${url}`); return url;
      }
    } catch (e) { if (e.message?.startsWith('SSRF')) throw e; continue; }
  }
  return null;
}
