import { promises as dns } from 'dns';
import path from 'path';
import { ALLOW_LOCAL, PRIVATE_IP_RE, CRED_PARAMS, ROOT_DIR } from './constants.js';

// SEC-1: Block private/internal network addresses
export async function assertSafeUrl(urlStr) {
  if (ALLOW_LOCAL) return;
  let hostname;
  try { hostname = new URL(urlStr).hostname; }
  catch { throw new Error(`Invalid URL: ${urlStr}`); }

  if (/^(localhost|0\.0\.0\.0)$/i.test(hostname))
    throw new Error(`SSRF blocked: ${hostname} is not allowed`);

  if (PRIVATE_IP_RE.some(re => re.test(hostname)))
    throw new Error(`SSRF blocked: ${hostname} is a private/internal address`);

  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const { address } of records) {
      if (PRIVATE_IP_RE.some(re => re.test(address)))
        throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${address}`);
    }
  } catch (e) {
    if (e.message.startsWith('SSRF')) throw e;
  }
}

// SEC-3: Prevent path traversal when loading local specs
export function assertSafeLocalPath(filePath) {
  if (!ALLOW_LOCAL)
    throw new Error('Local file access is disabled. Set BLOBFISH_ALLOW_LOCAL=true to enable.');
  const resolved = path.resolve(filePath);
  const allowedBase = path.resolve(process.env.BLOBFISH_LOCAL_DIR || ROOT_DIR);
  if (resolved !== allowedBase && !resolved.startsWith(allowedBase + path.sep))
    throw new Error(`Path traversal blocked: file is outside allowed directory`);
  return resolved;
}

// SEC-2: Strip control characters and cap length
export function sanitizeDesc(str, maxLen = 300) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen);
}

// SEC-6: Redact credential query params before logging
export function scrubUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    for (const k of u.searchParams.keys()) {
      if (CRED_PARAMS.has(k.toLowerCase())) u.searchParams.set(k, '[REDACTED]');
    }
    return u.toString();
  } catch { return urlStr; }
}

// SEC-10: Strip file paths from error messages
export function sanitizeError(err) {
  let msg = err?.message || String(err);
  msg = msg.replace(/[A-Za-z]:\\[^\s,;]*/g, '[path]');
  msg = msg.replace(/\/[^\s,;]{3,}/g, '[path]');
  return msg;
}
