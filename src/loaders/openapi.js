import SwaggerParser from '@apidevtools/swagger-parser';
import path from 'path';
import { assertSafeUrl, assertSafeLocalPath, sanitizeDesc } from '../security.js';
import { buildInputSchema, getBaseUrl, getMockResponse } from '../utils.js';
import { loadedApis, toolMeta } from '../state.js';
import { updateRateLimit } from '../ratelimit.js';
import { slugify, toToolName } from '../utils.js';
import { makeUniqueName } from '../registry.js';
import { withRetry, executeRequest } from '../http.js';
import { DEFAULT_TIMEOUT, DEFAULT_RETRIES, MAX_TOOLS_PER_SPEC } from '../constants.js';

export async function loadSpec(specUrl, nameHint, auth, mock = false, timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, includeTags = null, excludeTags = null, shallow = false) {
  const isLocal = !specUrl.startsWith('http://') && !specUrl.startsWith('https://');
  let resolved;
  if (isLocal) {
    resolved = assertSafeLocalPath(specUrl);
  } else {
    await assertSafeUrl(specUrl);
    resolved = specUrl;
  }

  const api = await SwaggerParser.dereference(resolved);
  const name = slugify(nameHint || api.info?.title);
  const baseUrl = getBaseUrl(api);
  const tools = [], handlers = new Map(), tagMap = {};
  let testEndpoint = null;

  for (const tag of (api.tags || [])) tagMap[tag.name] = { description: sanitizeDesc(tag.description || ''), count: 0 };

  for (const [p, pathItem] of Object.entries(api.paths || {})) {
    const sharedParams = pathItem.parameters || [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem[method]; if (!op) continue;

      if (includeTags?.length && !op.tags?.some(t => includeTags.includes(t))) continue;
      if (excludeTags?.length && op.tags?.some(t => excludeTags.includes(t))) continue;

      const toolName = makeUniqueName(toToolName(name, method, p));
      const schema = buildInputSchema(op, sharedParams, shallow);
      const desc = sanitizeDesc(op.summary || op.description || `${method.toUpperCase()} ${p}`);

      tools.push({ name: toolName, description: desc, inputSchema: schema });
      toolMeta.set(toolName, { method, apiName: name });

      handlers.set(toolName, mock
        ? () => ({ status: 200, ok: true, mock: true, data: getMockResponse(op), headers: {} })
        : (args) => withRetry(() => executeRequest(baseUrl, method, p, op, args, loadedApis.get(name)?.auth ?? auth, timeout, name), retries)
      );

      if (method === 'get' && !testEndpoint && (schema.required || []).length === 0) testEndpoint = { method, path: p, operation: op };
      for (const tag of (op.tags || ['(untagged)'])) { if (!tagMap[tag]) tagMap[tag] = { description: '', count: 0 }; tagMap[tag].count++; }
    }
  }

  if (tools.length > MAX_TOOLS_PER_SPEC)
    throw new Error(`Spec generates ${tools.length} tools (max ${MAX_TOOLS_PER_SPEC}). Use include_tags to filter — e.g. include_tags: ["repos", "issues"]`);

  loadedApis.set(name, {
    specUrl: resolved, title: api.info?.title || name, description: sanitizeDesc(api.info?.description || ''),
    version: api.info?.version || '', tags: tagMap, tools, handlers, auth, mock, baseUrl, testEndpoint, timeout, retries,
  });
  console.error(`[Blobfish] Loaded "${api.info?.title}" as "${name}" — ${tools.length} tools${mock ? ' [mock]' : ''}${includeTags ? ` [tags: ${includeTags.join(',')}]` : ''}`);
  return { name, count: tools.length, title: api.info?.title };
}
