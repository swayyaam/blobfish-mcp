import fs from 'fs';
import path from 'path';
import { assertSafeUrl, assertSafeLocalPath } from '../security.js';
import { loadSpec } from './openapi.js';
import { loadPostman } from './postman.js';

function isPostmanCollection(parsed) {
  return parsed.info?._postman_id || (typeof parsed.info?.schema === 'string' && parsed.info.schema.includes('postman'));
}

export async function autoLoad(source, nameHint, auth, mock, timeout, retries, includeTags, excludeTags, shallow) {
  const isLocal = !source.startsWith('http://') && !source.startsWith('https://');
  if (isLocal) {
    const resolved = assertSafeLocalPath(source);
    const raw = fs.readFileSync(resolved, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      if (isPostmanCollection(parsed)) return loadPostman(source, nameHint, auth, mock, timeout, retries);
    } catch { /* not JSON — fall through to OpenAPI (handles YAML) */ }
    return loadSpec(source, nameHint, auth, mock, timeout, retries, includeTags, excludeTags, shallow);
  }

  await assertSafeUrl(source);

  // Fetch once, sniff format, pass raw text to the appropriate loader
  let text;
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(5000) });
    text = await res.text();
  } catch (e) {
    if (e.message?.startsWith('SSRF')) throw e;
    // Fetch failed — let loadSpec try (it will fail with a clearer error)
    return loadSpec(source, nameHint, auth, mock, timeout, retries, includeTags, excludeTags, shallow);
  }

  try {
    const parsed = JSON.parse(text);
    if (isPostmanCollection(parsed)) {
      // Pass pre-fetched text so loadPostman doesn't fetch again
      return loadPostmanFromText(text, source, nameHint, auth, mock, timeout, retries);
    }
  } catch { /* not JSON — treat as OpenAPI YAML or let SwaggerParser decide */ }

  return loadSpec(source, nameHint, auth, mock, timeout, retries, includeTags, excludeTags, shallow);
}

// Variant of loadPostman that accepts already-fetched text, avoiding a second HTTP call
async function loadPostmanFromText(raw, source, nameHint, auth, mock, timeout, retries) {
  // Temporarily monkey-patch the source so loadPostman doesn't re-fetch
  // Instead, delegate to the full loader but write a temp entry — cleanest to just
  // inline the load here using the same logic as loadPostman
  const { loadPostmanRaw } = await import('./postman.js');
  if (loadPostmanRaw) return loadPostmanRaw(raw, source, nameHint, auth, mock, timeout, retries);
  // Fallback: loadPostman will fetch again — acceptable if loadPostmanRaw isn't exported
  return loadPostman(source, nameHint, auth, mock, timeout, retries);
}
