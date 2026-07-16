# Architecture

Last updated: 2026-07-16

## System overview

Blobfish is a single Node.js process (ESM, no build step) that speaks the MCP protocol over stdio (default), HTTP, or SSE. At startup it loads pre-configured APIs from blobfish.json and .env auto-detection. When Claude calls load_api or discover_api, Blobfish parses the spec at runtime and emits a tools/list_changed notification — new tools appear in Claude immediately without restarting.

## Components

| Component | File | Responsibility |
|-----------|------|----------------|
| Entry point | server.js | MCP server init, transport selection, startup loading, hot-reload |
| Setup wizard | setup.js | Auto-configure Claude Desktop config file |
| Constants | src/constants.js | All env vars, limits, probe paths |
| State | src/state.js | Shared in-memory Maps (loadedApis, cache, rateLimitState, savedWorkflows, requestLog) |
| Security | src/security.js | SSRF guard, path traversal, error sanitisation, URL scrubbing |
| HTTP | src/http.js | executeRequest, withRetry, rate-limit aware, oauth2 token resolution + 401 retry |
| OAuth | src/oauth.js | client_credentials token fetch, memory cache, refresh 60s before expiry, single-flight |
| Config | src/config.js | Profile-aware config path resolution, per-API auth_profiles selection, CLI arg parsing |
| Cache | src/cache.js | TTL response cache, hit/miss stats |
| Rate limiter | src/ratelimit.js | Parse x-ratelimit headers, block + wait |
| Pagination | src/pagination.js | detectNextPage (Link header, cursor, offset), findDataArray with priority |
| Workflow | src/workflow.js | {{ template }} resolution, condition evaluation |
| Utils | src/utils.js | slugify, buildAuthHeaders, buildInputSchema, mock generation, shallowSchema |
| Registry | src/registry.js | getAllTools, findHandler, makeUniqueName (collision prevention) |
| Auto loader | src/loaders/auto.js | Sniff format (OpenAPI vs Postman), fetch once, dispatch |
| OpenAPI loader | src/loaders/openapi.js | SwaggerParser.dereference → tools + handlers |
| Postman loader | src/loaders/postman.js | Postman collection v2.1 → tools + handlers |
| Probe | src/loaders/probe.js | Auto-discover spec URL from just a domain |
| Registry loader | src/loaders/registry.js | Read registry/*.json, auth interpolation, unresolved var detection |
| Env auto-loader | src/loaders/env.js | Scan registry at startup; load entries whose auth env vars are all present |
| Meta tool defs | src/tools/meta.js | MCP inputSchema definitions for all 17 meta-tools |
| Meta handlers | src/tools/handlers.js | Handler logic for every meta-tool + dynamic tool dispatch |

## Transport modes

| Flag | Transport | Use case |
|------|-----------|----------|
| (none) | stdio | Claude Desktop, Cursor, Cline, Zed |
| --http | StreamableHTTP on :3000/mcp | Remote agents, web-based clients |
| --sse | SSE on :3000/sse | Older MCP clients |
| --setup | Runs setup.js | Claude Desktop auto-config |

Port configurable via BLOBFISH_PORT env var.

## State model

All state is in-memory Maps in src/state.js. Currently does NOT persist across restarts (planned for 1.4.0).

loadedApis: Map<apiName, { specUrl, title, tools[], handlers Map, auth, mock, baseUrl, tags, testEndpoint, isPostman }>
toolMeta: Map<toolName, { method, apiName }>
responseCache: Map<cacheKey, { data, expiresAt }>
rateLimitState: Map<apiName, { blockedUntil }>
savedWorkflows: Map<name, { steps[], description }>
oauthTokens: Map<token_url|client_id|scope, { token, expiresAt, pending }> (memory-only by decision — see DECISIONS.md)
requestLog: Array (ring buffer, max 20)

## Tool naming

{api_name}_{http_method}_{path_slug}
e.g. stripe_post_v1_charges

- api_name: slugified info.title, max 20 chars
- path_slug: leading / removed, {params} braces stripped, non-alphanumeric → _
- Collision prevention: makeUniqueName() appends _1, _2 etc if needed
- Meta-tool names are reserved and cannot be shadowed by dynamic tools

## Security model

- SEC-1: SSRF guard on all outbound URLs (DNS lookup, private IP block)
- SEC-2: sanitizeDesc strips control chars, caps at 300 chars
- SEC-3: Path traversal guard on local file loads (requires BLOBFISH_ALLOW_LOCAL=true)
- SEC-6: Credential query params redacted from request logs
- SEC-7: Meta-tool names reserved, dynamic tools cannot shadow them
- SEC-9: Retry-After capped at 60s
- SEC-10: File paths stripped from error messages shown to Claude

## Registry format

registry/<name>.json
Required: name, title, spec_url
Optional: description, auth { type, key, header, username, password, token_url, client_id, client_secret, scope, audience, client_auth }, include_tags[], exclude_tags[], shallow, mock, notes

Auth values support ${ENV_VAR} interpolation. Unresolved vars throw a Claude-readable error with fix instructions.

## Known architectural gaps (planned fixes)

- No persistence: loadedApis lost on restart → fix in 1.4.0 (includes oauthTokens if decided)
- No GraphQL support → 1.5.0
- responseCache has no proactive eviction / size cap → fix in 1.4.0
