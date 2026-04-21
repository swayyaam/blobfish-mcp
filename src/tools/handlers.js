import { loadedApis, responseCache, rateLimitState, requestLog, cacheStats, savedWorkflows } from '../state.js';
import { findHandler, findTool, getAllTools } from '../registry.js';
import { getCacheKey, getCached, setCached, recordHit, recordMiss } from '../cache.js';
import { waitIfRateLimited } from '../ratelimit.js';
import { resolveValue, resolveArgs, evaluateCondition } from '../workflow.js';
import { detectNextPage, findDataArray } from '../pagination.js';
import { assertSafeUrl } from '../security.js';
import { sanitizeError } from '../security.js';
import { toolMeta } from '../state.js';
import { executeRequest } from '../http.js';
import { loadSpec } from '../loaders/openapi.js';
import { autoLoad } from '../loaders/auto.js';
import { probeSpecUrl } from '../loaders/probe.js';
import { getRegistryEntry, listRegistryEntries, isRegistryName } from '../loaders/registry.js';
import { interpolateObj } from '../utils.js';
import { DEFAULT_TIMEOUT, DEFAULT_RETRIES, MAX_LOG_ENTRIES, MAX_RESP_SIZE } from '../constants.js';
import { META_TOOLS } from './meta.js';

export async function handleToolCall(req, { notifyToolsChanged }) {
  const { name, arguments: args = {} } = req.params;
  try {

    if (name === 'discover_api') {
      const { base_url, name: nameHint, auth, mock, timeout, include_tags, exclude_tags, shallow } = args;
      const specUrl = await probeSpecUrl(base_url);
      if (!specUrl) return { content: [{ type: 'text', text: `Could not find spec at ${base_url}. Tried ${(await import('../constants.js')).SPEC_PROBE_PATHS.length} paths.` }], isError: true };
      const result = await loadSpec(specUrl, nameHint, auth, mock, timeout, DEFAULT_RETRIES, include_tags, exclude_tags, shallow);
      await notifyToolsChanged();
      return { content: [{ type: 'text', text: `Discovered: ${specUrl}\nLoaded "${result.title}" as "${result.name}" — ${result.count} tools.` }] };
    }

    if (name === 'list_registry') {
      const entries = listRegistryEntries();
      if (entries.length === 0) return { content: [{ type: 'text', text: 'No registry entries found. Add JSON files to the registry/ folder.' }] };
      const lines = entries.map(e =>
        `• ${e.name} — ${e.title}${e.auth_required ? ' 🔑' : ' (no auth)'}${e.description ? `\n  ${e.description}` : ''}${e.notes ? `\n  Note: ${e.notes}` : ''}`
      );
      return { content: [{ type: 'text', text: `${entries.length} APIs in registry. Load any with: load_api("name")\n\n${lines.join('\n\n')}` }] };
    }

    if (name === 'load_api') {
      let { spec_url, name: nameHint, auth, mock, timeout, retries, include_tags, exclude_tags, shallow } = args;

      // Registry lookup: "github" → registry/github.json
      if (isRegistryName(spec_url)) {
        const entry = getRegistryEntry(spec_url);
        if (entry) {
          nameHint   = nameHint   ?? entry.name;
          auth       = auth       ?? (entry.auth ? interpolateObj(entry.auth) : undefined);
          include_tags = include_tags ?? entry.include_tags;
          exclude_tags = exclude_tags ?? entry.exclude_tags;
          shallow    = shallow    ?? entry.shallow;
          mock       = mock       ?? entry.mock;
          spec_url   = entry.spec_url;
        } else {
          return { content: [{ type: 'text', text: `"${spec_url}" not found in registry. Run list_registry to see available APIs, or pass a full URL.` }], isError: true };
        }
      }

      const result = await autoLoad(spec_url, nameHint, auth, mock, timeout, retries, include_tags, exclude_tags, shallow);
      await notifyToolsChanged();
      return { content: [{ type: 'text', text: `Loaded "${result.title}" as "${result.name}" — ${result.count} tools.` }] };
    }

    if (name === 'set_api_auth') {
      const { name: apiName, auth } = args;
      const api = loadedApis.get(apiName);
      if (!api) return { content: [{ type: 'text', text: `No API named "${apiName}". Use list_apis to see what's loaded.` }], isError: true };
      api.auth = auth;
      return { content: [{ type: 'text', text: `Auth updated for "${apiName}". All subsequent calls will use the new credentials.` }] };
    }

    if (name === 'fetch_all') {
      const { tool_name, args: toolArgs = {}, max_pages = 10 } = args;
      const handler = findHandler(tool_name);
      if (!handler) return { content: [{ type: 'text', text: `Tool "${tool_name}" not found.` }], isError: true };
      const allItems = []; let currentArgs = { ...toolArgs }, nextUrl = null, pages = 0;
      while (pages < max_pages) {
        let response;
        if (nextUrl) {
          await assertSafeUrl(nextUrl);
          const res = await fetch(nextUrl, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT) });
          const cl = parseInt(res.headers.get('content-length') || '0');
          if (cl > MAX_RESP_SIZE) break;
          const text = await res.text();
          if (text.length > MAX_RESP_SIZE) break;
          let data; try { data = JSON.parse(text); } catch { data = text; }
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

        if (step.run_if !== undefined) {
          const condition = resolveValue(String(step.run_if), context);
          if (!evaluateCondition(condition)) {
            stepLog.push({ id: stepId, tool: step.tool, skipped: true, run_if: condition });
            continue;
          }
        }

        const handler = findHandler(step.tool);
        if (!handler) return { content: [{ type: 'text', text: `Step "${stepId}": tool "${step.tool}" not found.` }], isError: true };

        if (step.foreach !== undefined) {
          const collection = resolveArgs(step.foreach, context);
          const items = Array.isArray(collection) ? collection : [];
          const itemResults = [];
          for (let j = 0; j < items.length; j++) {
            const itemContext = { ...context, item: items[j], index: j };
            try { itemResults.push(await handler(resolveArgs(step.args || {}, itemContext))); }
            catch (e) { itemResults.push({ ok: false, error: sanitizeError(e) }); }
          }
          results[stepId] = { count: itemResults.length, items: itemResults };
          results[i] = results[stepId];
          stepLog.push({ id: stepId, tool: step.tool, foreach: true, count: itemResults.length, ok: true });
          continue;
        }

        const resolvedArgs = resolveArgs(step.args || {}, context);
        try {
          const result = await handler(resolvedArgs);
          results[stepId] = result; results[i] = result;
          stepLog.push({ id: stepId, tool: step.tool, status: result.status, ok: result.ok });
        } catch (err) {
          const msg = sanitizeError(err);
          if (step.on_error === 'continue') {
            results[stepId] = { ok: false, error: msg };
            stepLog.push({ id: stepId, tool: step.tool, ok: false, error: msg });
          } else {
            return { content: [{ type: 'text', text: `Workflow failed at step "${stepId}": ${msg}\nCompleted: ${JSON.stringify(stepLog)}` }], isError: true };
          }
        }
      }
      return { content: [{ type: 'text', text: JSON.stringify({ completed: stepLog.length, steps: stepLog, results }, null, 2) }] };
    }

    if (name === 'get_last_request_log') {
      const n = Math.min(Math.max(1, args.n ?? 1), MAX_LOG_ENTRIES);
      const entries = requestLog.slice(0, n);
      if (entries.length === 0) return { content: [{ type: 'text', text: 'No requests logged yet. Make an API call first.' }] };
      return { content: [{ type: 'text', text: JSON.stringify(entries, null, 2) }] };
    }

    if (name === 'rate_limit_status') {
      if (rateLimitState.size === 0) return { content: [{ type: 'text', text: 'No active rate limits. All APIs are ready.' }] };
      const lines = [...rateLimitState.entries()].map(([api, { blockedUntil }]) => {
        const remaining = blockedUntil - Date.now();
        return remaining > 0
          ? `• ${api}: blocked for ${Math.ceil(remaining / 1000)}s (resets at ${new Date(blockedUntil).toISOString()})`
          : `• ${api}: limit reset — ready`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }

    if (name === 'cache_stats') {
      const { hits, misses } = cacheStats;
      const total = hits + misses;
      const entries = [...responseCache.entries()].map(([key, { expiresAt }]) => ({ key, expires_in: `${Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))}s` }));
      return { content: [{ type: 'text', text: JSON.stringify({ size: responseCache.size, hits, misses, hit_rate: total ? `${((hits / total) * 100).toFixed(1)}%` : 'n/a', entries }, null, 2) }] };
    }

    if (name === 'clear_cache') {
      const { api_name } = args;
      let cleared = 0;
      if (api_name) {
        for (const key of responseCache.keys()) { if (key.startsWith(api_name + '_')) { responseCache.delete(key); cleared++; } }
      } else { cleared = responseCache.size; responseCache.clear(); cacheStats.hits = 0; cacheStats.misses = 0; }
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
      await notifyToolsChanged();
      return { content: [{ type: 'text', text: `Unloaded "${args.name}".` }] };
    }

    // Dynamic tool dispatch
    const handler = findHandler(name);
    if (!handler) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };

    const meta = toolMeta.get(name);
    const isGet = meta?.method === 'get';
    const apiName = meta?.apiName;
    const ttl = loadedApis.get(apiName)?.cacheTtl ?? (await import('../constants.js')).DEFAULT_CACHE_TTL;

    if (isGet && ttl > 0) {
      const key = getCacheKey(name, args);
      const cached = getCached(key);
      if (cached) { recordHit(); return { content: [{ type: 'text', text: JSON.stringify({ ...cached, _cached: true }, null, 2) }] }; }
      recordMiss();
    }

    if (apiName) await waitIfRateLimited(apiName);
    const result = await handler(args);
    if (isGet && ttl > 0 && result.ok) setCached(getCacheKey(name, args), result, ttl);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };

  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }], isError: true };
  }
}
