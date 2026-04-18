#!/usr/bin/env node
import { config } from 'dotenv';
config();
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import SwaggerParser from '@apidevtools/swagger-parser';

// name → { specUrl, title, description, tags, tools: [], handlers: Map }
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

const META_TOOLS = [
  {
    name: 'discover_api',
    description: 'Automatically find and load an API from just a domain or base URL — no spec URL needed. Probes common OpenAPI/Swagger spec paths and loads the first one found.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string', description: 'Domain or base URL to probe (e.g. "api.stripe.com", "petstore.swagger.io")' },
        name: { type: 'string', description: 'Optional short name prefix for tools' },
      },
      required: ['base_url'],
    },
  },
  {
    name: 'load_api',
    description: 'Load any OpenAPI/Swagger spec by exact URL and make all its endpoints available as tools instantly.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_url: { type: 'string', description: 'Direct URL to an OpenAPI or Swagger JSON/YAML spec' },
        name: { type: 'string', description: 'Optional short name prefix for tools' },
      },
      required: ['spec_url'],
    },
  },
  {
    name: 'api_summary',
    description: 'Get a plain-English overview of a loaded API — what it does, its capability groups, and endpoint count by category.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API name to summarize (as shown in list_apis)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_apis',
    description: 'List all currently loaded APIs and how many tools each one provides.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'unload_api',
    description: 'Remove a loaded API and all its tools.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API name to unload (as shown by list_apis)' },
      },
      required: ['name'],
    },
  },
];

function slugify(str) {
  return (str || 'api')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20) || 'api';
}

function toToolName(apiName, method, path) {
  const slug = path
    .replace(/^\//, '')
    .replace(/[{}]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return slug ? `${apiName}_${method}_${slug}` : `${apiName}_${method}`;
}

function buildInputSchema(operation, sharedParams = []) {
  const properties = {};
  const required = [];

  const params = [...sharedParams, ...(operation.parameters || [])];
  for (const p of params) {
    if (!['path', 'query', 'header'].includes(p.in)) continue;
    properties[p.name] = {
      type: p.schema?.type || p.type || 'string',
      description: p.description || `${p.in} parameter`,
    };
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

async function probeSpecUrl(baseUrl) {
  if (!baseUrl.startsWith('http')) baseUrl = 'https://' + baseUrl;
  baseUrl = baseUrl.replace(/\/$/, '');

  for (const path of SPEC_PROBE_PATHS) {
    try {
      const url = baseUrl + path;
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

async function executeRequest(baseUrl, method, pathTemplate, operation, args) {
  let url = baseUrl + pathTemplate;
  const headers = {};
  const queryParams = new URLSearchParams();

  const apiKey = process.env.API_KEY;
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

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

async function loadSpec(specUrl, nameHint) {
  const api = await SwaggerParser.dereference(specUrl);
  const name = slugify(nameHint || api.info?.title);
  const baseUrl = getBaseUrl(api);
  const tools = [];
  const handlers = new Map();

  // Collect tags with descriptions for api_summary
  const tagMap = {};
  for (const tag of (api.tags || [])) {
    tagMap[tag.name] = { description: tag.description || '', count: 0 };
  }

  for (const [path, pathItem] of Object.entries(api.paths || {})) {
    const sharedParams = pathItem.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem[method];
      if (!op) continue;

      const toolName = toToolName(name, method, path);
      tools.push({
        name: toolName,
        description: op.summary || op.description || `${method.toUpperCase()} ${path}`,
        inputSchema: buildInputSchema(op, sharedParams),
      });
      handlers.set(toolName, (args) => executeRequest(baseUrl, method, path, op, args));

      // Track tag counts
      for (const tag of (op.tags || ['(untagged)'])) {
        if (!tagMap[tag]) tagMap[tag] = { description: '', count: 0 };
        tagMap[tag].count++;
      }
    }
  }

  loadedApis.set(name, {
    specUrl,
    title: api.info?.title || name,
    description: api.info?.description || '',
    version: api.info?.version || '',
    tags: tagMap,
    tools,
    handlers,
  });

  console.error(`[Blobfish] Loaded "${api.info?.title || specUrl}" as "${name}" — ${tools.length} tools`);
  return { name, count: tools.length, title: api.info?.title };
}

function getAllTools() {
  return [...loadedApis.values()].flatMap(api => api.tools);
}

function findHandler(toolName) {
  for (const { handlers } of loadedApis.values()) {
    if (handlers.has(toolName)) return handlers.get(toolName);
  }
  return null;
}

const server = new Server(
  { name: 'blobfish', version: '3.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...META_TOOLS, ...getAllTools()],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;

  try {
    if (name === 'discover_api') {
      const { base_url, name: nameHint } = args;
      const specUrl = await probeSpecUrl(base_url);
      if (!specUrl) {
        return {
          content: [{ type: 'text', text: `Could not find an OpenAPI spec at ${base_url}. Tried ${SPEC_PROBE_PATHS.length} common paths. Try load_api with a direct spec URL instead.` }],
          isError: true,
        };
      }
      const result = await loadSpec(specUrl, nameHint);
      await server.sendToolListChanged();
      return {
        content: [{
          type: 'text',
          text: `Discovered spec at ${specUrl}\nLoaded "${result.title}" as "${result.name}" — ${result.count} tools now available.\nUse api_summary("${result.name}") to see what it can do.`,
        }],
      };
    }

    if (name === 'load_api') {
      const { spec_url, name: nameHint } = args;
      const result = await loadSpec(spec_url, nameHint);
      await server.sendToolListChanged();
      return {
        content: [{
          type: 'text',
          text: `Loaded "${result.title}" as "${result.name}" — ${result.count} tools now available.\nUse api_summary("${result.name}") to see what it can do.`,
        }],
      };
    }

    if (name === 'api_summary') {
      const { name: apiName } = args;
      const api = loadedApis.get(apiName);
      if (!api) {
        return { content: [{ type: 'text', text: `No API named "${apiName}". Use list_apis to see what's loaded.` }], isError: true };
      }
      const tagLines = Object.entries(api.tags)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([tag, { description, count }]) =>
          `  • ${tag} (${count} endpoint${count !== 1 ? 's' : ''})${description ? ` — ${description}` : ''}`
        );
      const summary = [
        `${api.title} v${api.version}`,
        api.description ? `\n${api.description}` : '',
        `\n${api.tools.length} total endpoints across ${Object.keys(api.tags).length} groups:\n`,
        tagLines.join('\n'),
        `\nSpec: ${api.specUrl}`,
      ].join('');
      return { content: [{ type: 'text', text: summary }] };
    }

    if (name === 'list_apis') {
      if (loadedApis.size === 0) {
        return { content: [{ type: 'text', text: 'No APIs loaded yet. Use discover_api or load_api to get started.' }] };
      }
      const lines = [...loadedApis.entries()].map(
        ([n, { title, tools }]) => `• ${n} — "${title}" (${tools.length} tools)`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'unload_api') {
      const { name: apiName } = args;
      if (!loadedApis.has(apiName)) {
        return { content: [{ type: 'text', text: `No API named "${apiName}". Use list_apis to see what's loaded.` }], isError: true };
      }
      loadedApis.delete(apiName);
      await server.sendToolListChanged();
      return { content: [{ type: 'text', text: `Unloaded "${apiName}".` }] };
    }

    const handler = findHandler(name);
    if (!handler) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
    const result = await handler(args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };

  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

for (const url of process.argv.slice(2)) {
  await loadSpec(url);
}

console.error(`[Blobfish] Ready — ${META_TOOLS.length} meta-tools${loadedApis.size ? `, ${getAllTools().length} API tools` : ''}`);

const transport = new StdioServerTransport();
await server.connect(transport);
