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
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    if (isPostmanCollection(parsed)) return loadPostman(source, nameHint, auth, mock, timeout, retries);
    return loadSpec(source, nameHint, auth, mock, timeout, retries, includeTags, excludeTags, shallow);
  }
  await assertSafeUrl(source);
  try {
    const text = await fetch(source, { signal: AbortSignal.timeout(5000) }).then(r => r.text());
    if (isPostmanCollection(JSON.parse(text))) return loadPostman(source, nameHint, auth, mock, timeout, retries);
  } catch (e) { if (e.message?.startsWith('SSRF')) throw e; }
  return loadSpec(source, nameHint, auth, mock, timeout, retries, includeTags, excludeTags, shallow);
}
