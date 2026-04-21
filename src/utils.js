import fs from 'fs';
import { sanitizeDesc, scrubUrl } from './security.js';
import { LOG_PATH, MAX_LOG_ENTRIES } from './constants.js';
import { requestLog } from './state.js';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function interpolateEnv(val) {
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (_, n) => process.env[n] ?? '');
}

export function interpolateObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = typeof v === 'object' ? interpolateObj(v) : interpolateEnv(v);
  return out;
}

export function logRequest(entry) {
  const record = { ts: new Date().toISOString(), ...entry, url: scrubUrl(entry.url) };
  requestLog.unshift(record);
  if (requestLog.length > MAX_LOG_ENTRIES) requestLog.pop();
  if (!LOG_PATH) return;
  fs.appendFileSync(LOG_PATH, JSON.stringify(record) + '\n');
}

export function slugify(str) {
  return (str || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'api';
}

export function toToolName(apiName, method, p) {
  const slug = p.replace(/^\//, '').replace(/[{}]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  return slug ? `${apiName}_${method}_${slug}` : `${apiName}_${method}`;
}

export function buildAuthHeaders(auth) {
  const headers = {};
  if (!auth) { const key = process.env.API_KEY; if (key) headers['Authorization'] = `Bearer ${key}`; return headers; }
  switch (auth.type) {
    case 'bearer': if (auth.key) headers['Authorization'] = `Bearer ${auth.key}`; break;
    case 'apikey': if (auth.key) headers[auth.header || 'X-Api-Key'] = auth.key; break;
    case 'basic': if (auth.username) headers['Authorization'] = `Basic ${Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64')}`; break;
  }
  return headers;
}

export function getBaseUrl(api) {
  if (api.servers?.[0]?.url) return api.servers[0].url.replace(/\/$/, '');
  if (api.host) return `${api.schemes?.[0] || 'https'}://${api.host}${api.basePath || ''}`.replace(/\/$/, '');
  return '';
}

export function generateMockFromSchema(schema, depth = 0) {
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

export function getMockResponse(operation) {
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

// Item 7: Reduce token usage by stripping deeply nested schemas
export function shallowSchema(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return schema;
  if (depth >= 2) return { type: schema.type || 'object', description: schema.description };
  const out = { ...schema };
  if (out.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = shallowSchema(v, depth + 1);
  }
  if (out.items) out.items = shallowSchema(out.items, depth + 1);
  return out;
}

export function buildInputSchema(operation, sharedParams = [], shallow = false) {
  const properties = {}, required = [];
  const params = [...sharedParams, ...(operation.parameters || [])];
  for (const p of params) {
    if (!['path', 'query', 'header'].includes(p.in)) continue;
    let propSchema = { type: p.schema?.type || p.type || 'string', description: sanitizeDesc(p.description || `${p.in} parameter`) };
    if (!shallow && p.schema) propSchema = { ...propSchema, ...p.schema };
    properties[p.name] = propSchema;
    if (p.required) required.push(p.name);
  }
  const jsonBody = operation.requestBody?.content?.['application/json']?.schema;
  if (jsonBody) {
    properties.body = shallow ? { type: 'object', description: 'Request body (JSON)' } : { ...jsonBody, description: 'Request body (JSON)' };
    if (operation.requestBody.required) required.push('body');
  }
  const bodyParam = (operation.parameters || []).find(p => p.in === 'body');
  if (bodyParam) {
    properties.body = shallow ? { type: 'object', description: sanitizeDesc(bodyParam.description || 'Request body') } : { ...(bodyParam.schema || { type: 'object' }), description: sanitizeDesc(bodyParam.description || 'Request body') };
    if (bodyParam.required) required.push('body');
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}
