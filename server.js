#!/usr/bin/env node
import { config } from 'dotenv';
config();
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import SwaggerParser from '@apidevtools/swagger-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Global state ──────────────────────────────────────────────────────────────

const loadedApis    = new Map(); // apiName → api entry
const toolMeta      = new Map(); // toolName → { method, apiName }
const responseCache = new Map(); // cacheKey → { data, expiresAt }
const rateLimitState = new Map(); // apiName → { blockedUntil }
const savedWorkflows = new Map(); // name → { steps }
let cacheHits = 0, cacheMisses = 0;

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT   = parseInt(process.env.BLOBFISH_TIMEOUT   ?? '30000');
const DEFAULT_RETRIES   = parseInt(process.env.BLOBFISH_RETRIES   ?? '3');
const DEFAULT_CACHE_TTL = parseInt(process.env.BLOBFISH_CACHE_TTL ?? '60');
const LOG_PATH = process.env.BLOBFISH_LOG
  ? (process.env.BLOBFISH_LOG === 'true' ? path.join(__dirname, 'blobfish.log') : process.env.BLOBFISH_LOG)
  : null;

const SPEC_PROBE_PATHS = [
  '/openapi.json', '/openapi.yaml', '/swagger.json', '/swagger.yaml',
  '/api/openapi.json', '/api/swagger.json', '/api-docs', '/api-docs/swagger.json',
  '/v1/openapi.json', '/v2/openapi.json', '/v3/openapi.json',
  '/api/v1/openapi.json', '/api/v2/openapi.json', '/public/openapi.json', '/docs/openapi.json',
];

const AUTH_SCHEMA = {
  type: 'object',
  description: 'Auth config for this API',
  properties: {
    type: { type: 'string', enum: ['bearer', 'apikey', 'basic', 'none'] },
    key: { type: 'string' }, header: { type: 'string' },
    username: { type: 'string' }, password: { type: 'string' },
  },
};

const META_TOOLS = [
  {
    name: 'discover_api',
    description: 'Auto-find and load an API from just a domain — no spec URL needed.',
    inputSchema: { type: 'object', properties: { base_url: { type: 'string' }, name: { type: 'string' }, auth: AUTH_SCHEMA, mock: { type: 'boolean' }, timeout: { type: 'integer' } }, required: ['base_url'] },
  },
  {
    name: 'load_api',
    description: 'Load any OpenAPI/Swagger spec or Postman collection — by URL or local file path.',
    inputSchema: { type: 'object', properties: { spec_url: { type: 'string' }, name: { type: 'string' }, auth: AUTH_SCHEMA, mock: { type: 'boolean' }, timeout: { type: 'integer' }, retries: { type: 'integer' } }, required: ['spec_url'] },
  },
  {
    name: 'fetch_all',
    description: 'Fetch all pages of a paginated endpoint automatically. Handles Link headers, cursor, offset pagination.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, args: { type: 'object', default: {} }, max_pages: { type: 'integer', default: 10 } }, required: ['tool_name'] },
  },
  {
    name: 'run_workflow',
    description: 'Run a multi-step workflow where each step can reference previous results using {{ steps.stepId.data.field }} syntax.',
    inputSchema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Steps to run in order',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Step identifier for referencing in later steps' },
              tool: { type: 'string', description: 'Tool name to call' },
              args: { type: 'object', description: 'Args — use {{ steps.stepId.data.field }} or {{ input.field }}' },
              on_error: { type: 'string', enum: ['stop', 'continue'], default: 'stop' },
            },
            required: ['tool'],
          },
        },
        input: { type: 'object', description: 'Initial data, referenced as {{ input.fieldName }}' },
      },
      required: ['steps'],
    },
  },
  {
    name: 'cache_stats',
    description: 'Show response cache statistics — hit rate, size, and cached entries.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clear_cache',
    description: 'Clear the response cache. Optionally clear only one API\'s cached entries.',
    inputSchema: { type: 'object', properties: { api_name: { type: 'string', description: 'Clear only this API\'s cache (omit to clear all)' } } },
  },
  {
    name: 'test_connection',
    description: 'Test if a loaded API is reachable. Returns status code and response time.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'inspect_tool',
    description: 'Show the full schema of any loaded tool — description and all input parameters.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' } }, required: ['tool_name'] },
  },
  {
    name: 'api_summary',
    description: 'Plain-English overview of a loaded API — purpose, capability groups, endpoint count.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'list_apis',
    description: 'List all currently loaded APIs and how many tools each provides.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'unload_api',
    description: 'Remove a loaded API and all its tools.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function interpolateEnv(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (_, n) => process.env[n] ?? '');
}
function interpolateObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'object' ? interpolateObj(v) : interpolateEnv(v);
  return out;
}

function logRequest(entry) {
  if (!LOG_PATH) return;
  fs.appendFileSync(LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

function slugify(str) {
  return (str || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'api';
}
function toToolName(apiName, method, p) {
  const slug = p.replace(/^\//, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug ? `${apiName}_${method}_${slug}` : `${apiName}_${method}`;
}
function buildInputSchema(operation, sharedParams = []) {
  const properties = {}, required = [];
  const params = [...sharedParams, ...(operation.parameters || [])];
  for (const p of params) {
    if (!['path', 'query', 'header'].includes(p.in)) continue;
    properties[p.name] = { type: p.schema?.type || p.type || 'string', description: p.description || `${p.in} parameter` };
    if (p.required) required.push(p.name);
  }
  const jsonBody = operation.requestBody?.content?.['application/json']?.schema;
  if (jsonBody) { properties.body = { ...jsonBody, description: 'Request body (JSON)' }; if (operation.requestBody.required) required.push('body'); }
  const bodyParam = (operation.parameters || []).find(p => p.in === 'body');
  if (bodyParam) { properties.body = { ...(bodyParam.schema || { type: 'object' }), description: bodyParam.description || 'Request body' }; if (bodyParam.required) required.push('body'); }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}
function getBaseUrl(api) {
  if (api.servers?.[0]?.url) return api.servers[0].url.replace(/\/$/, '');
  if (api.host) return `${api.schemes?.[0] || 'https'}://${api.host}${api.basePath || ''}`.replace(/\/$/, '');
  return '';
}
function buildAuthHeaders(auth) {
  const headers = {};
  if (!auth) { const key = process.env.API_KEY; if (key) headers['Authorization'] = `Bearer ${key}`; return headers; }
  switch (auth.type) {
    case 'bearer': if (auth.key) headers['Authorization'] = `Bearer ${auth.key}`; break;
    case 'apikey': if (auth.key) headers[auth.header || 'X-Api-Key'] = auth.key; break;
    case 'basic': if (auth.username) headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64')}`; break;
  }
  return headers;
}
function generateMockFromSchema(schema, depth = 0) {
  if (!schema || depth > 3) return null;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case 'string': return schema.enum?.[0] ?? 'string';
    case 'integer': case 'number': return 0;
    case 'boolean': return false;
    case 'array': return schema.items ? [generateMockFromSchema(schema.items, depth + 1)] : [];
    case 'object': { const obj = {}; for (const [k, v] of Object.entries(schema.properties || {})) obj[k] = generateMockFromSchema(v, depth + 1); return obj; }
    default: return 'example';
  }
}
function getMockResponse(operation) {
  for (const code of ['200', '201', '202', '2XX', 'default']) {
    const resp = operation.responses?.[code]; if (!resp) continue;
    const content = resp.content?.['application/json'];
    if (content?.example) return content.example;
    if (content?.schema?.example) return content.schema.example;
    if (content?.schema) return generateMockFromSchema(content.schema);
    return { message: resp.description || 'OK' };
  }
  return { mock: true };
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function getCacheKey(toolName, args) {
  const stable = JSON.stringify(args, Object.keys(args || {}).sort());
  return `${toolName}:${stable}`;
}
function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { responseCache.delete(key); return null; }
  return entry.data;
}
function setCached(key, data, ttlSeconds) {
  responseCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

function updateRateLimit(apiName, headers) {
  const remaining = parseInt(headers['x-ratelimit-remaining'] ?? headers['ratelimit-remaining'] ?? headers['x-rate-limit-remaining'] ?? '999');
  const reset = parseInt(headers['x-ratelimit-reset'] ?? headers['ratelimit-reset'] ?? headers['x-rate-limit-reset'] ?? '0');
  if (remaining <= 1 && reset > 0) {
    const blockedUntil = reset > 1_000_000_000 ? reset * 1000 : Date.now() + reset * 1000;
    rateLimitState.set(apiName, { blockedUntil });
    console.error(`[Blobfish] "${apiName}" rate limit hit — waiting until ${new Date(blockedUntil).toISOString()}`);
  }
}
async function waitIfRateLimited(apiName) {
  const state = rateLimitState.get(apiName);
  if (!state) return;
  const waitMs = state.blockedUntil - Date.now();
  if (waitMs > 0) {
    console.error(`[Blobfish] Pausing ${Math.ceil(waitMs / 1000)}s for "${apiName}" rate limit...`);
    await sleep(waitMs);
  }
  rateLimitState.delete(apiName);
}

// ── Workflow ──────────────────────────────────────────────────────────────────

function resolveValue(val, context) {
  if (typeof val !== 'string') return val;
  return val.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    let cur = context;
    for (const part of expr.trim().split('.')) { if (cur == null) return ''; cur = cur[part]; }
    return cur != null ? String(cur) : '';
  });
}
function resolveArgs(val, context) {
  if (typeof val === 'string') return resolveValue(val, context);
  if (Array.isArray(val)) return val.map(v => resolveArgs(v, context));
  if (val && typeof val === 'object') { const out = {}; for (const [k, v] of Object.entries(val)) out[k] = resolveArgs(v, context); return out; }
  return val;
}

// ── Pagination ────────────────────────────────────────────────────────────────

function findDataArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;
  for (const val of Object.values(data)) { if (Array.isArray(val) && val.length > 0) return val; }
  return null;
}
function detectNextPage(data, headers, currentArgs) {
  const link = headers?.link || headers?.Link || '';
  const linkMatch = link.match(/<([^>]+)>;\s*rel="next"/);
  if (linkMatch) return { type: 'url', url: linkMatch[1] };
  if (!data || typeof data !== 'object') return null;
  const meta = data.meta || data.pagination || data.paging || data;
  for (const field of ['next', 'next_url', 'next_cursor', 'cursor', 'next_page_token', 'after', 'continuation_token']) {
    const val = meta[field]; if (val && typeof val === 'string') return { type: 'cursor', field, value: val };
  }
  if (data.has_more === true) { const limit = currentArgs.limit ?? currentArgs.per_page ?? 20; return { type: 'offset', offset: (currentArgs.offset ?? 0) + limit, limit }; }
  if (typeof data.total === 'number' && typeof data.offset === 'number' && typeof data.limit === 'number') {
    const next = data.offset + data.limit; if (next < data.total) return { type: 'offset', offset: next, limit: data.limit };
  }
  return null;
}

// ── Probe ─────────────────────────────────────────────────────────────────────

async function probeSpecUrl(baseUrl) {
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
  baseUrl = baseUrl.replace(/\/$/, '');
  for (const p of SPEC_PROBE_PATHS) {
    try {
      const url = baseUrl + p;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes('"openapi"') || text.includes('"swagger"') || text.includes('openapi:') || text.includes('swagger:')) {
        console.error(`[Blobfish] Found spec at ${url}`); return url;
      }
    } catch { continue; }
  }
  return null;
}

// ── HTTP execution ────────────────────────────────────────────────────────────

async function withRetry(fn, retries = DEFAULT_RETRIES, delay = 1000) {
  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fn();
      if (result.status === 429 && i < retries) {
        const retryAfter = parseInt(result.headers?.['retry-after'] ?? '5');
        const waitMs = retryAfter > 1000 ? retryAfter : retryAfter * 1000;
        console.error(`[Blobfish] 429 — waiting ${retryAfter}s before retry...`);
        await sleep(Math.min(waitMs, 60000)); continue;
      }
      if (result.status >= 500 && i < retries) { await sleep(delay * 2 ** i); continue; }
      return result;
    } catch (err) { if (i === retries) throw err; await sleep(delay * 2 ** i); }
  }
}

async function executeRequest(baseUrl, method, pathTemplate, operation, args, auth, timeout = DEFAULT_TIMEOUT, apiName = null) {
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
  const init = { method: method.toUpperCase(), headers, signal: AbortSignal.timeout(timeout) };
  if (args.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(args.body); }
  const t0 = Date.now();
  const res = await fetch(url, init);
  const ms = Date.now() - t0;
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const resHeaders = {};
  for (const [k, v] of res.headers.entries()) resHeaders[k.toLowerCase()] = v;
  logRequest({ method: method.toUpperCase(), url, status: res.status, ms });
  if (apiName) updateRateLimit(apiName, resHeaders);
  return { status: res.status, ok: res.ok, data, headers: resHeaders };
}

// ── Load OpenAPI/Swagger ──────────────────────────────────────────────────────

async function loadSpec(specUrl, nameHint, auth, mock = false, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES) {
  const isLocal = !specUrl.startsWith('http://') && !specUrl.startsWith('https://');
  const resolved = isLocal ? path.resolve(specUrl) : specUrl;
  const api = await SwaggerParser.dereference(resolved);
  const name = slugify(nameHint || api.info?.title);
  const baseUrl = getBaseUrl(api);
  const tools = [], handlers = new Map(), tagMap = {};
  let testEndpoint = null;
  for (const tag of (api.tags || [])) tagMap[tag.name] = { description: tag.description || '', count: 0 };
  for (const [p, pathItem] of Object.entries(api.paths || {})) {
    const sharedParams = pathItem.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem[method]; if (!op) continue;
      const toolName = toToolName(name, method, p);
      const schema = buildInputSchema(op, sharedParams);
      tools.push({ name: toolName, description: op.summary || op.description || `${method.toUpperCase()} ${p}`, inputSchema: schema });
      toolMeta.set(toolName, { method, apiName: name });
      handlers.set(toolName, mock
        ? () => ({ status: 200, ok: true, mock: true, data: getMockResponse(op), headers: {} })
        : (args) => withRetry(() => executeRequest(baseUrl, method, p, op, args, auth, timeout, name), retries)
      );
      if (method === 'get' && !testEndpoint && (schema.required || []).length === 0) testEndpoint = { method, path: p, operation: op };
      for (const tag of (op.tags || ['(untagged)'])) { if (!tagMap[tag]) tagMap[tag] = { description: '', count: 0 }; tagMap[tag].count++; }
    }
  }
  loadedApis.set(name, { specUrl: resolved, title: api.info?.title || name, description: api.info?.description || '', version: api.info?.version || '', tags: tagMap, tools, handlers, auth, mock, baseUrl, testEndpoint, timeout, retries });
  console.error(`[Blobfish] Loaded "${api.info?.title}" as "${name}" — ${tools.length} tools${mock ? ' [mock]' : ''}`);
  return { name, count: tools.length, title: api.info?.title };
}

// ── Load Postman collection ───────────────────────────────────────────────────

function flattenPostmanItems(items) {
  const out = [];
  for (const item of items) { if (Array.isArray(item.item)) out.push(...flattenPostmanItems(item.item)); else if (item.request) out.push(item); }
  return out;
}
async function loadPostman(source, nameHint, auth, mock = false, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES) {
  const isLocal = !source.startsWith('http');
  const raw = isLocal ? fs.readFileSync(path.resolve(source), 'utf8') : await fetch(source).then(r => r.text());
  const collection = JSON.parse(raw);
  const name = slugify(nameHint || collection.info?.name);
  const tools = [], handlers = new Map();
  for (const item of flattenPostmanItems(collection.item || [])) {
    const req = item.request;
    const method = (req.method || 'GET').toLowerCase();
    const rawUrl = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
    const urlVars = typeof req.url === 'object' ? (req.url.variable || []) : [];
    const queryItems = typeof req.url === 'object' ? (req.url.query || []) : [];
    const toolName = `${name}_${method}_${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 64);
    const properties = {}, required = [];
    for (const v of urlVars) { properties[v.key] = { type: 'string', description: v.description || `Path variable: ${v.key}` }; required.push(v.key); }
    for (const q of queryItems) { if (!q.disabled) properties[q.key] = { type: 'string', description: q.description || q.key }; }
    if (req.body?.raw) properties.body = { type: 'object', description: 'Request body' };
    tools.push({ name: toolName, description: item.name, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } });
    toolMeta.set(toolName, { method, apiName: name });
    handlers.set(toolName, async (args) => {
      if (mock) return { status: 200, ok: true, mock: true, data: { message: 'Mock response' }, headers: {} };
      let url = rawUrl;
      for (const [k, v] of Object.entries(args)) url = url.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), encodeURIComponent(String(v)));
      const qp = new URLSearchParams();
      for (const q of queryItems) { if (!q.disabled && args[q.key]) qp.set(q.key, args[q.key]); }
      const qs = qp.toString(); if (qs) url += (url.includes('?') ? '&' : '?') + qs;
      const headers = buildAuthHeaders(auth);
      for (const h of (req.header || [])) { if (!h.disabled) headers[h.key] = h.value; }
      const init = { method: method.toUpperCase(), headers, signal: AbortSignal.timeout(timeout) };
      if (args.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(args.body); }
      else if (req.body?.raw && method !== 'get') { headers['Content-Type'] = 'application/json'; init.body = req.body.raw; }
      const t0 = Date.now(); const res = await fetch(url, init); const ms = Date.now() - t0;
      const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
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

// ── Auto-detect format ────────────────────────────────────────────────────────

async function autoLoad(source, nameHint, auth, mock, timeout, retries) {
  const isLocal = !source.startsWith('http://') && !source.startsWith('https://');
  if (isLocal) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
    if (parsed.info?._postman_id || (typeof parsed.info?.schema === 'string' && parsed.info.schema.includes('postman')))
      return loadPostman(source, nameHint, auth, mock, timeout, retries);
    return loadSpec(source, nameHint, auth, mock, timeout, retries);
  }
  try {
    const text = await fetch(source, { signal: AbortSignal.timeout(5000) }).then(r => r.text());
    const parsed = JSON.parse(text);
    if (parsed.info?._postman_id || (typeof parsed.info?.schema === 'string' && parsed.info.schema.includes('postman')))
      return loadPostman(source, nameHint, auth, mock, timeout, retries);
  } catch { /* fall through */ }
  return loadSpec(source, nameHint, auth, mock, timeout, retries);
}

// ── Server ────────────────────────────────────────────────────────────────────

function getAllTools() { return [...loadedApis.values()].flatMap(a => a.tools); }
function findHandler(n) { for (const { handlers } of loadedApis.values()) { if (handlers.has(n)) return handlers.get(n); } return null; }
function findTool(n) { for (const { tools } of loadedApis.values()) { const t = tools.find(t => t.name === n); if (t) return t; } return null; }

const server = new Server({ name: 'blobfish', version: '6.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...META_TOOLS, ...getAllTools()] }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {

    if (name === 'discover_api') {
      const { base_url, name: nameHint, auth, mock, timeout } = args;
      const specUrl = await probeSpecUrl(base_url);
      if (!specUrl) return { content: [{ type: 'text', text: `Could not find spec at ${base_url}. Tried ${SPEC_PROBE_PATHS.length} paths.` }], isError: true };
      const result = await loadSpec(specUrl, nameHint, auth, mock, timeout);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Discovered: ${specUrl}\nLoaded "${result.title}" as "${result.name}" — ${result.count} tools.` }] };
    }

    if (name === 'load_api') {
      const { spec_url, name: nameHint, auth, mock, timeout, retries } = args;
      const result = await autoLoad(spec_url, nameHint, auth, mock, timeout, retries);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Loaded "${result.title}" as "${result.name}" — ${result.count} tools.` }] };
    }

    if (name === 'fetch_all') {
      const { tool_name, args: toolArgs = {}, max_pages = 10 } = args;
      const handler = findHandler(tool_name);
      if (!handler) return { content: [{ type: 'text', text: `Tool "${tool_name}" not found.` }], isError: true };
      const allItems = []; let currentArgs = { ...toolArgs }, nextUrl = null, pages = 0;
      while (pages < max_pages) {
        let response;
        if (nextUrl) {
          const res = await fetch(nextUrl, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
          const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
          const h = {}; for (const [k, v] of res.headers.entries()) h[k.toLowerCase()] = v;
          response = { status: res.status, ok: res.ok, data, headers: h };
        } else { response = await handler(currentArgs); }
        if (!response.ok) break;
        pages++;
        const items = findDataArray(response.data);
        if (items) allItems.push(...items); else if (pages === 1) { allItems.push(response.data); break; }
        const next = detectNextPage(response.data, response.headers || {}, currentArgs);
        if (!next) break;
        if (next.type === 'url') { nextUrl = next.url; }
        else if (next.type === 'cursor') { nextUrl = null; currentArgs = { ...currentArgs, [next.field]: next.value }; }
        else if (next.type === 'offset') { nextUrl = null; currentArgs = { ...currentArgs, offset: next.offset }; }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ pages_fetched: pages, total_items: allItems.length, data: allItems }, null, 2) }] };
    }

    if (name === 'run_workflow') {
      const { steps, input = {} } = args;
      const results = {}, stepLog = [];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepId = step.id || String(i);
        const context = { input, steps: results };
        const resolvedArgs = resolveArgs(step.args || {}, context);
        const handler = findHandler(step.tool);
        if (!handler) return { content: [{ type: 'text', text: `Step "${stepId}": tool "${step.tool}" not found.` }], isError: true };
        try {
          const result = await handler(resolvedArgs);
          results[stepId] = result; results[i] = result;
          stepLog.push({ id: stepId, tool: step.tool, status: result.status, ok: result.ok });
        } catch (err) {
          if (step.on_error === 'continue') {
            results[stepId] = { ok: false, error: err.message };
            stepLog.push({ id: stepId, tool: step.tool, ok: false, error: err.message });
          } else {
            return { content: [{ type: 'text', text: `Workflow failed at step "${stepId}": ${err.message}\nCompleted: ${JSON.stringify(stepLog)}` }], isError: true };
          }
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ completed: stepLog.length, steps: stepLog, results }, null, 2) }] };
    }

    if (name === 'cache_stats') {
      const total = cacheHits + cacheMisses;
      const entries = [...responseCache.entries()].map(([key, { expiresAt }]) => ({
        key, expires_in: `${Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))}s`
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ size: responseCache.size, hits: cacheHits, misses: cacheMisses, hit_rate: total ? `${((cacheHits / total) * 100).toFixed(1)}%` : 'n/a', entries }, null, 2) }] };
    }

    if (name === 'clear_cache') {
      const { api_name } = args;
      let cleared = 0;
      if (api_name) {
        for (const key of responseCache.keys()) { if (key.startsWith(api_name + '_')) { responseCache.delete(key); cleared++; } }
      } else { cleared = responseCache.size; responseCache.clear(); cacheHits = 0; cacheMisses = 0; }
      return { content: [{ type: 'text', text: `Cleared ${cleared} cache entries.` }] };
    }

    if (name === 'test_connection') {
      const api = loadedApis.get(args.name);
      if (!api) return { content: [{ type: 'text', text: `No API named "${args.name}".` }], isError: true };
      if (api.mock) return { content: [{ type: 'text', text: `"${args.name}" is mock mode — no real connections.` }] };
      if (!api.testEndpoint) return { content: [{ type: 'text', text: `No simple GET endpoint found in "${args.name}".` }] };
      const { method, path: p, operation } = api.testEndpoint;
      const t0 = Date.now();
      const result = await executeRequest(api.baseUrl, method, p, operation, {}, api.auth, api.timeout, args.name);
      return { content: [{ type: 'text', text: `${args.name} — ${result.ok ? '✓ reachable' : '✗ error'}\nStatus: ${result.status} | ${Date.now() - t0}ms\nEndpoint: ${method.toUpperCase()} ${p}` }] };
    }

    if (name === 'inspect_tool') {
      const tool = findTool(args.tool_name);
      if (!tool) return { content: [{ type: 'text', text: `Tool "${args.tool_name}" not found.` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(tool, null, 2) }] };
    }

    if (name === 'api_summary') {
      const api = loadedApis.get(args.name);
      if (!api) return { content: [{ type: 'text', text: `No API named "${args.name}".` }], isError: true };
      const tagLines = Object.entries(api.tags).sort((a, b) => b[1].count - a[1].count).map(([tag, { description, count }]) => `  • ${tag} (${count} endpoint${count !== 1 ? 's' : ''})${description ? ` — ${description}` : ''}`);
      return { content: [{ type: 'text', text: [`${api.title} v${api.version}${api.mock ? ' [mock]' : ''}${api.isPostman ? ' [Postman]' : ''}`, api.description ? `\n${api.description}` : '', `\n${api.tools.length} endpoints${tagLines.length ? `:\n${tagLines.join('\n')}` : ''}`, `\nSpec: ${api.specUrl}`].join('') }] };
    }

    if (name === 'list_apis') {
      if (loadedApis.size === 0) return { content: [{ type: 'text', text: 'No APIs loaded. Use discover_api or load_api.' }] };
      const lines = [...loadedApis.entries()].map(([n, { title, tools, mock }]) => `• ${n} — "${title}" (${tools.length} tools)${mock ? ' [mock]' : ''}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'unload_api') {
      if (!loadedApis.has(args.name)) return { content: [{ type: 'text', text: `No API named "${args.name}".` }], isError: true };
      loadedApis.delete(args.name);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Unloaded "${args.name}".` }] };
    }

    // Dynamic tool dispatch
    const handler = findHandler(name);
    if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

    const meta = toolMeta.get(name);
    const isGet = meta?.method === 'get';
    const apiName = meta?.apiName;
    const ttl = loadedApis.get(apiName)?.cacheTtl ?? DEFAULT_CACHE_TTL;

    if (isGet && ttl > 0) {
      const key = getCacheKey(name, args);
      const cached = getCached(key);
      if (cached) { cacheHits++; return { content: [{ type: 'text', text: JSON.stringify({ ...cached, _cached: true }, null, 2) }] }; }
      cacheMisses++;
    }

    if (apiName) await waitIfRateLimited(apiName);

    const result = await handler(args);

    if (isGet && ttl > 0 && result.ok) setCached(getCacheKey(name, args), result, ttl);

    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };

  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────

const blobfishConfigPath = path.join(__dirname, 'blobfish.json');
if (fs.existsSync(blobfishConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(blobfishConfigPath, 'utf8'));
  for (const wf of Object.entries(cfg.workflows || {})) savedWorkflows.set(wf[0], wf[1]);
  for (const entry of (cfg.apis || [])) {
    await autoLoad(entry.url, entry.name, interpolateObj(entry.auth), entry.mock || false, entry.timeout ?? cfg.timeout, entry.retries ?? cfg.retries);
  }
}

for (const url of process.argv.slice(2)) await loadSpec(url);

console.error(`[Blobfish] Ready — ${META_TOOLS.length} meta-tools${loadedApis.size ? `, ${getAllTools().length} API tools` : ''}${LOG_PATH ? ` | log → ${LOG_PATH}` : ''}`);

const transport = new StdioServerTransport();
await server.connect(transport);
