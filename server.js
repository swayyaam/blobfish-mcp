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

// name → { specUrl, title, description, version, tags, tools, handlers, auth, mock, baseUrl, testEndpoint }
const loadedApis = new Map();

const SPEC_PROBE_PATHS = [
  '/openapi.json', '/openapi.yaml',
  '/swagger.json', '/swagger.yaml',
  '/api/openapi.json', '/api/swagger.json',
  '/api-docs', '/api-docs/swagger.json',
  '/v1/openapi.json', '/v2/openapi.json', '/v3/openapi.json',
  '/api/v1/openapi.json', '/api/v2/openapi.json',
  '/public/openapi.json', '/docs/openapi.json',
];

const AUTH_SCHEMA = {
  type: 'object',
  description: 'Auth config for this API',
  properties: {
    type: { type: 'string', enum: ['bearer', 'apikey', 'basic', 'none'], description: 'bearer | apikey | basic | none' },
    key: { type: 'string', description: 'Token or API key (bearer/apikey)' },
    header: { type: 'string', description: 'Header name for apikey auth (default: X-Api-Key)' },
    username: { type: 'string', description: 'Username for basic auth' },
    password: { type: 'string', description: 'Password for basic auth' },
  },
};

const META_TOOLS = [
  {
    name: 'discover_api',
    description: 'Auto-find and load an API from just a domain — no spec URL needed. Probes common OpenAPI/Swagger paths and loads the first one found.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string', description: 'Domain or base URL (e.g. "api.stripe.com")' },
        name: { type: 'string', description: 'Optional name prefix for tools' },
        auth: AUTH_SCHEMA,
        mock: { type: 'boolean', description: 'Return example responses instead of real HTTP calls' },
      },
      required: ['base_url'],
    },
  },
  {
    name: 'load_api',
    description: 'Load any OpenAPI/Swagger spec or Postman collection — by URL or local file path. All endpoints become callable tools instantly.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_url: { type: 'string', description: 'URL, local file path (./api.json), or Postman collection URL' },
        name: { type: 'string', description: 'Optional name prefix for tools' },
        auth: AUTH_SCHEMA,
        mock: { type: 'boolean', description: 'Return example responses instead of real HTTP calls' },
      },
      required: ['spec_url'],
    },
  },
  {
    name: 'test_connection',
    description: 'Test if a loaded API is reachable by hitting its first available GET endpoint. Returns status and response time.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API name to test (from list_apis)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'inspect_tool',
    description: 'Show the full schema of any loaded tool — its description and all input parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        tool_name: { type: 'string', description: 'Exact tool name to inspect' },
      },
      required: ['tool_name'],
    },
  },
  {
    name: 'api_summary',
    description: 'Plain-English overview of a loaded API — purpose, capability groups, and endpoint count by category.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API name (from list_apis)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_apis',
    description: 'List all currently loaded APIs and how many tools each provides.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'unload_api',
    description: 'Remove a loaded API and all its tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API name to unload (from list_apis)' },
      },
      required: ['name'],
    },
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(str) {
  return (str || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'api';
}

function toToolName(apiName, method, p) {
  const slug = p.replace(/^\//, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug ? `${apiName}_${method}_${slug}` : `${apiName}_${method}`;
}

function buildInputSchema(operation, sharedParams = []) {
  const properties = {};
  const required = [];
  const params = [...sharedParams, ...(operation.parameters || [])];
  for (const p of params) {
    if (!['path', 'query', 'header'].includes(p.in)) continue;
    properties[p.name] = { type: p.schema?.type || p.type || 'string', description: p.description || `${p.in} parameter` };
    if (p.required) required.push(p.name);
  }
  const jsonBody = operation.requestBody?.content?.['application/json']?.schema;
  if (jsonBody) {
    properties.body = { ...jsonBody, description: 'Request body (JSON)' };
    if (operation.requestBody.required) required.push('body');
  }
  const bodyParam = (operation.parameters || []).find(p => p.in === 'body');
  if (bodyParam) {
    properties.body = { ...(bodyParam.schema || { type: 'object' }), description: bodyParam.description || 'Request body' };
    if (bodyParam.required) required.push('body');
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

function getBaseUrl(api) {
  if (api.servers?.[0]?.url) return api.servers[0].url.replace(/\/$/, '');
  if (api.host) {
    const scheme = api.schemes?.[0] || 'https';
    return `${scheme}://${api.host}${api.basePath || ''}`.replace(/\/$/, '');
  }
  return '';
}

function buildAuthHeaders(auth) {
  const headers = {};
  if (!auth) {
    const key = process.env.API_KEY;
    if (key) headers['Authorization'] = `Bearer ${key}`;
    return headers;
  }
  switch (auth.type) {
    case 'bearer':
      if (auth.key) headers['Authorization'] = `Bearer ${auth.key}`;
      break;
    case 'apikey':
      if (auth.key) headers[auth.header || 'X-Api-Key'] = auth.key;
      break;
    case 'basic':
      if (auth.username) headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64')}`;
      break;
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
    case 'object': {
      const obj = {};
      for (const [k, v] of Object.entries(schema.properties || {})) obj[k] = generateMockFromSchema(v, depth + 1);
      return obj;
    }
    default: return 'example';
  }
}

function getMockResponse(operation) {
  for (const code of ['200', '201', '202', '2XX', 'default']) {
    const resp = operation.responses?.[code];
    if (!resp) continue;
    const content = resp.content?.['application/json'];
    if (content?.example) return content.example;
    if (content?.schema?.example) return content.schema.example;
    if (content?.schema) return generateMockFromSchema(content.schema);
    return { message: resp.description || 'OK' };
  }
  return { mock: true };
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
        console.error(`[Blobfish] Found spec at ${url}`);
        return url;
      }
    } catch { continue; }
  }
  return null;
}

// ── HTTP execution ────────────────────────────────────────────────────────────

async function executeRequest(baseUrl, method, pathTemplate, operation, args, auth) {
  let url = baseUrl + pathTemplate;
  const headers = buildAuthHeaders(auth);
  const queryParams = new URLSearchParams();
  for (const p of (operation.parameters || [])) {
    const val = args[p.name];
    if (val === undefined || val === null) continue;
    if (p.in === 'path') url = url.replace(`{${p.name}}`, encodeURIComponent(String(val)));
    else if (p.in === 'query') queryParams.set(p.name, String(val));
    else if (p.in === 'header') headers[p.name] = String(val);
  }
  const qs = queryParams.toString();
  if (qs) url += `?${qs}`;
  const init = { method: method.toUpperCase(), headers };
  if (args.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(args.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

// ── Load OpenAPI/Swagger ──────────────────────────────────────────────────────

async function loadSpec(specUrl, nameHint, auth, mock = false) {
  const isLocal = !specUrl.startsWith('http://') && !specUrl.startsWith('https://');
  const resolved = isLocal ? path.resolve(specUrl) : specUrl;
  const api = await SwaggerParser.dereference(resolved);
  const name = slugify(nameHint || api.info?.title);
  const baseUrl = getBaseUrl(api);
  const tools = [];
  const handlers = new Map();
  const tagMap = {};
  let testEndpoint = null;

  for (const tag of (api.tags || [])) tagMap[tag.name] = { description: tag.description || '', count: 0 };

  for (const [p, pathItem] of Object.entries(api.paths || {})) {
    const sharedParams = pathItem.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem[method];
      if (!op) continue;
      const toolName = toToolName(name, method, p);
      const schema = buildInputSchema(op, sharedParams);
      tools.push({ name: toolName, description: op.summary || op.description || `${method.toUpperCase()} ${p}`, inputSchema: schema });
      handlers.set(toolName, mock
        ? () => ({ status: 200, ok: true, mock: true, data: getMockResponse(op) })
        : (args) => executeRequest(baseUrl, method, p, op, args, auth)
      );
      if (method === 'get' && !testEndpoint && (schema.required || []).length === 0) {
        testEndpoint = { method, path: p, operation: op };
      }
      for (const tag of (op.tags || ['(untagged)'])) {
        if (!tagMap[tag]) tagMap[tag] = { description: '', count: 0 };
        tagMap[tag].count++;
      }
    }
  }

  loadedApis.set(name, { specUrl: resolved, title: api.info?.title || name, description: api.info?.description || '', version: api.info?.version || '', tags: tagMap, tools, handlers, auth, mock, baseUrl, testEndpoint });
  console.error(`[Blobfish] Loaded "${api.info?.title}" as "${name}" — ${tools.length} tools${mock ? ' [mock]' : ''}`);
  return { name, count: tools.length, title: api.info?.title };
}

// ── Load Postman collection ───────────────────────────────────────────────────

function flattenPostmanItems(items) {
  const out = [];
  for (const item of items) {
    if (Array.isArray(item.item)) out.push(...flattenPostmanItems(item.item));
    else if (item.request) out.push(item);
  }
  return out;
}

async function loadPostman(source, nameHint, auth, mock = false) {
  const isLocal = !source.startsWith('http');
  const raw = isLocal ? fs.readFileSync(path.resolve(source), 'utf8') : await fetch(source).then(r => r.text());
  const collection = JSON.parse(raw);
  const name = slugify(nameHint || collection.info?.name);
  const tools = [];
  const handlers = new Map();

  for (const item of flattenPostmanItems(collection.item || [])) {
    const req = item.request;
    const method = (req.method || 'GET').toLowerCase();
    const rawUrl = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
    const urlVars = typeof req.url === 'object' ? (req.url.variable || []) : [];
    const queryItems = typeof req.url === 'object' ? (req.url.query || []) : [];

    const toolName = `${name}_${method}_${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`.slice(0, 64);
    const properties = {};
    const required = [];

    for (const v of urlVars) {
      properties[v.key] = { type: 'string', description: v.description || `Path variable: ${v.key}` };
      required.push(v.key);
    }
    for (const q of queryItems) {
      if (!q.disabled) properties[q.key] = { type: 'string', description: q.description || q.key };
    }
    if (req.body?.raw) properties.body = { type: 'object', description: 'Request body' };

    tools.push({ name: toolName, description: item.name, inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) } });

    handlers.set(toolName, async (args) => {
      if (mock) return { status: 200, ok: true, mock: true, data: { message: 'Mock response' } };
      let url = rawUrl;
      for (const [k, v] of Object.entries(args)) url = url.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), encodeURIComponent(String(v)));
      const qp = new URLSearchParams();
      for (const q of queryItems) { if (!q.disabled && args[q.key]) qp.set(q.key, args[q.key]); }
      const qs = qp.toString();
      if (qs) url += (url.includes('?') ? '&' : '?') + qs;
      const headers = buildAuthHeaders(auth);
      for (const h of (req.header || [])) { if (!h.disabled) headers[h.key] = h.value; }
      const init = { method: method.toUpperCase(), headers };
      if (args.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(args.body); }
      else if (req.body?.raw && method !== 'get') { headers['Content-Type'] = 'application/json'; init.body = req.body.raw; }
      const res = await fetch(url, init);
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, ok: res.ok, data };
    });
  }

  loadedApis.set(name, { specUrl: source, title: collection.info?.name || name, description: '', version: '', tags: {}, tools, handlers, auth, mock, baseUrl: '', testEndpoint: null, isPostman: true });
  console.error(`[Blobfish] Loaded Postman collection "${collection.info?.name}" as "${name}" — ${tools.length} tools`);
  return { name, count: tools.length, title: collection.info?.name };
}

// ── Auto-detect format ────────────────────────────────────────────────────────

async function autoLoad(source, nameHint, auth, mock) {
  const isLocal = !source.startsWith('http://') && !source.startsWith('https://');
  if (isLocal) {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(source), 'utf8'));
    if (parsed.info?._postman_id || (typeof parsed.info?.schema === 'string' && parsed.info.schema.includes('postman'))) {
      return loadPostman(source, nameHint, auth, mock);
    }
    return loadSpec(source, nameHint, auth, mock);
  }
  try {
    const text = await fetch(source, { signal: AbortSignal.timeout(5000) }).then(r => r.text());
    const parsed = JSON.parse(text);
    if (parsed.info?._postman_id || (typeof parsed.info?.schema === 'string' && parsed.info.schema.includes('postman'))) {
      return loadPostman(source, nameHint, auth, mock);
    }
  } catch { /* fall through to loadSpec */ }
  return loadSpec(source, nameHint, auth, mock);
}

// ── Server ────────────────────────────────────────────────────────────────────

function getAllTools() { return [...loadedApis.values()].flatMap(a => a.tools); }

function findHandler(toolName) {
  for (const { handlers } of loadedApis.values()) { if (handlers.has(toolName)) return handlers.get(toolName); }
  return null;
}

function findTool(toolName) {
  for (const { tools } of loadedApis.values()) { const t = tools.find(t => t.name === toolName); if (t) return t; }
  return null;
}

const server = new Server({ name: 'blobfish', version: '4.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...META_TOOLS, ...getAllTools()] }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'discover_api') {
      const { base_url, name: nameHint, auth, mock } = args;
      const specUrl = await probeSpecUrl(base_url);
      if (!specUrl) return { content: [{ type: 'text', text: `Could not find an OpenAPI spec at ${base_url}. Tried ${SPEC_PROBE_PATHS.length} paths. Try load_api with a direct URL.` }], isError: true };
      const result = await loadSpec(specUrl, nameHint, auth, mock);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Discovered spec at ${specUrl}\nLoaded "${result.title}" as "${result.name}" — ${result.count} tools.\nUse api_summary("${result.name}") for details.` }] };
    }

    if (name === 'load_api') {
      const { spec_url, name: nameHint, auth, mock } = args;
      const result = await autoLoad(spec_url, nameHint, auth, mock);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Loaded "${result.title}" as "${result.name}" — ${result.count} tools.\nUse api_summary("${result.name}") for details.` }] };
    }

    if (name === 'test_connection') {
      const { name: apiName } = args;
      const api = loadedApis.get(apiName);
      if (!api) return { content: [{ type: 'text', text: `No API named "${apiName}".` }], isError: true };
      if (api.mock) return { content: [{ type: 'text', text: `"${apiName}" is in mock mode — no real connections.` }] };
      if (!api.testEndpoint) return { content: [{ type: 'text', text: `No simple GET endpoint found in "${apiName}" for testing.` }] };
      const { method, path: p, operation } = api.testEndpoint;
      const start = Date.now();
      const result = await executeRequest(api.baseUrl, method, p, operation, {}, api.auth);
      const ms = Date.now() - start;
      return { content: [{ type: 'text', text: `${apiName} — ${result.ok ? '✓ reachable' : '✗ error'}\nStatus: ${result.status} | Response time: ${ms}ms\nEndpoint: ${method.toUpperCase()} ${p}` }] };
    }

    if (name === 'inspect_tool') {
      const { tool_name } = args;
      const tool = findTool(tool_name);
      if (!tool) return { content: [{ type: 'text', text: `Tool "${tool_name}" not found.` }], isError: true };
      return { content: [{ type: 'text', text: JSON.stringify(tool, null, 2) }] };
    }

    if (name === 'api_summary') {
      const { name: apiName } = args;
      const api = loadedApis.get(apiName);
      if (!api) return { content: [{ type: 'text', text: `No API named "${apiName}".` }], isError: true };
      const tagLines = Object.entries(api.tags).sort((a, b) => b[1].count - a[1].count).map(([tag, { description, count }]) => `  • ${tag} (${count} endpoint${count !== 1 ? 's' : ''})${description ? ` — ${description}` : ''}`);
      const summary = [`${api.title} v${api.version}${api.mock ? ' [mock]' : ''}${api.isPostman ? ' [Postman]' : ''}`, api.description ? `\n${api.description}` : '', `\n${api.tools.length} endpoints${tagLines.length ? `:\n${tagLines.join('\n')}` : ''}`, `\nSpec: ${api.specUrl}`].join('');
      return { content: [{ type: 'text', text: summary }] };
    }

    if (name === 'list_apis') {
      if (loadedApis.size === 0) return { content: [{ type: 'text', text: 'No APIs loaded. Use discover_api or load_api.' }] };
      const lines = [...loadedApis.entries()].map(([n, { title, tools, mock }]) => `• ${n} — "${title}" (${tools.length} tools)${mock ? ' [mock]' : ''}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'unload_api') {
      const { name: apiName } = args;
      if (!loadedApis.has(apiName)) return { content: [{ type: 'text', text: `No API named "${apiName}".` }], isError: true };
      loadedApis.delete(apiName);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Unloaded "${apiName}".` }] };
    }

    const handler = findHandler(name);
    if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    const result = await handler(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };

  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

// ── Startup ───────────────────────────────────────────────────────────────────

const blobfishConfig = path.join(__dirname, 'blobfish.json');
if (fs.existsSync(blobfishConfig)) {
  const { apis = [] } = JSON.parse(fs.readFileSync(blobfishConfig, 'utf8'));
  for (const entry of apis) await autoLoad(entry.url, entry.name, entry.auth, entry.mock || false);
}

for (const url of process.argv.slice(2)) await loadSpec(url);

console.error(`[Blobfish] Ready — ${META_TOOLS.length} meta-tools${loadedApis.size ? `, ${getAllTools().length} API tools` : ''}`);

const transport = new StdioServerTransport();
await server.connect(transport);
