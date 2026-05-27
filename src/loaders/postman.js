import fs from 'fs';
import path from 'path';
import { assertSafeUrl, assertSafeLocalPath, sanitizeDesc } from '../security.js';
import { buildAuthHeaders, logRequest } from '../utils.js';
import { slugify } from '../utils.js';
import { makeUniqueName } from '../registry.js';
import { loadedApis, toolMeta } from '../state.js';
import { updateRateLimit } from '../ratelimit.js';
import { DEFAULT_TIMEOUT, DEFAULT_RETRIES, MAX_RESP_SIZE } from '../constants.js';

function flattenItems(items) {
  const out = [];
  for (const item of items) { if (Array.isArray(item.item)) out.push(...flattenItems(item.item)); else if (item.request) out.push(item); }
  return out;
}

export async function loadPostmanRaw(raw, source, nameHint, auth, mock = false, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES) {
  const collection = JSON.parse(raw);
  return _buildPostmanApi(collection, source, nameHint, auth, mock, timeout, retries);
}

export async function loadPostman(source, nameHint, auth, mock = false, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES) {
  let raw;
  if (!source.startsWith('http')) {
    const resolved = assertSafeLocalPath(source);
    raw = fs.readFileSync(resolved, 'utf8');
  } else {
    await assertSafeUrl(source);
    raw = await fetch(source).then(r => r.text());
  }
  const collection = JSON.parse(raw);
  return _buildPostmanApi(collection, source, nameHint, auth, mock, timeout, retries);
}

async function _buildPostmanApi(collection, source, nameHint, auth, mock, timeout, retries) {
  const name = slugify(nameHint || collection.info?.name);
  const tools = [], handlers = new Map();

  for (const item of flattenItems(collection.item || [])) {
    const req = item.request;
    const method = (req.method || 'GET').toLowerCase();
    const rawUrl = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
    const urlVars = typeof req.url === 'object' ? (req.url.variable || []) : [];
    const queryItems = typeof req.url === 'object' ? (req.url.query || []) : [];

    const toolName = makeUniqueName(`${name}_${method}_${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 64));
    const properties = {}, required = [];
    for (const v of urlVars) { properties[v.key] = { type: 'string', description: sanitizeDesc(v.description || `Path variable: ${v.key}`) }; required.push(v.key); }
    for (const q of queryItems) { if (!q.disabled) properties[q.key] = { type: 'string', description: sanitizeDesc(q.description || q.key) }; }
    if (req.body?.raw) properties.body = { type: 'object', description: 'Request body' };

    tools.push({ name: toolName, description: sanitizeDesc(item.name), inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } });
    toolMeta.set(toolName, { method, apiName: name });

    handlers.set(toolName, async (args) => {
      if (mock) return { status: 200, ok: true, mock: true, data: { message: 'Mock response' }, headers: {} };
      let url = rawUrl;
      for (const [k, v] of Object.entries(args)) url = url.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), encodeURIComponent(String(v)));
      const qp = new URLSearchParams();
      for (const q of queryItems) { if (!q.disabled && args[q.key]) qp.set(q.key, args[q.key]); }
      const qs = qp.toString(); if (qs) url += (url.includes('?') ? '&' : '?') + qs;
      await assertSafeUrl(url);
      const currentAuth = loadedApis.get(name)?.auth ?? auth;
      const headers = buildAuthHeaders(currentAuth);
      for (const h of (req.header || [])) { if (!h.disabled) headers[h.key] = h.value; }
      const init = { method: method.toUpperCase(), headers, signal: AbortSignal.timeout(timeout) };
      if (args.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(args.body); }
      else if (req.body?.raw && method !== 'get') { headers['Content-Type'] = 'application/json'; init.body = req.body.raw; }
      const t0 = Date.now(); const res = await fetch(url, init); const ms = Date.now() - t0;
      const cl = parseInt(res.headers.get('content-length') || '0');
      if (cl > MAX_RESP_SIZE) throw new Error(`Response too large`);
      const text = await res.text();
      if (text.length > MAX_RESP_SIZE) throw new Error(`Response body too large`);
      let data; try { data = JSON.parse(text); } catch { data = text; }
      const resHeaders = {}; for (const [k, v] of res.headers.entries()) resHeaders[k.toLowerCase()] = v;
      logRequest({ method: method.toUpperCase(), url, status: res.status, ms });
      updateRateLimit(name, resHeaders);
      return { status: res.status, ok: res.ok, data, headers: resHeaders };
    });
  }

  loadedApis.set(name, { specUrl: source, title: collection.info?.name || name, description: '', version: '', tags: {}, tools, handlers, auth, mock, baseUrl: '', testEndpoint: null, isPostman: true, timeout, retries });
  console.error(`[Blobfish] Loaded Postman collection "${collection.info?.name}" as "${name}" — ${tools.length} tools`);
  return { name, count: tools.length, title: collection.info?.name };
}
