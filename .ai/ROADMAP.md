# Roadmap

Last updated: 2026-06-06

## North star

By 2.0: a developer should never have to call load_api manually.
Blobfish watches the project, sees what API keys exist, and silently makes those APIs available to Claude.
The developer doesn't configure anything. They don't know MCP exists.

---

## Current milestone

1.3.0 — OAuth
Goal: unlock every enterprise API that needs OAuth 2.0 client_credentials.

---

## Version plan

### 1.1.0 — SHIPPED (2026-05-27)
- Fixed version mismatch (package.json vs server.js)
- Fixed savedWorkflows actually being used
- Fixed autoLoad double-fetch for Postman
- Fixed findDataArray priority logic (no more false positives on errors[])
- Added save_workflow + list_workflows meta-tools (17 meta-tools total)
- Added --setup flag (npx blobfish-mcp --setup — no clone needed)
- Added --http and --sse transport flags
- Added BLOBFISH_PORT env var
- Added 10 registry entries (linear, twilio, hubspot, pagerduty, spotify, discord, jira, datadog, shopify, openweathermap) — 21 total
- Added Workflows section to README with inline examples
- Added CI badge to README
- Added CONTRIBUTING.md
- Added version check + registry validation to publish.yml
- Opted into Node.js 24 for GitHub Actions

### 1.2.0 — Zero Config — SHIPPED (2026-06-06)
- Auto-load from .env: scan registry at startup, load any entry whose auth env vars are all set (on by default, BLOBFISH_AUTO_LOAD=false to disable)
- Tool annotations: readOnlyHint/destructiveHint/idempotentHint/openWorldHint inferred from HTTP method on all OpenAPI and Postman tools
- Fix evaluateCondition: added >, <, >=, <= numeric comparison operators
- Expand SPEC_PROBE_PATHS: added .yml variants, /.well-known/openapi.json, /spec/ paths
- npm bin: added blobfish-mcp alias so npx blobfish-mcp works without publish warning

### 1.3.0 — Auth
Theme: unlock every enterprise API that needs OAuth

Features:
- OAuth 2.0 client_credentials flow (client_id + client_secret → auto-fetch bearer token)
- Token auto-refresh before expiry
- Per-API auth profiles in blobfish.json (staging vs production keys)
- Environment profiles: --profile staging loads a different blobfish.json

Done when:
  - [ ] Salesforce, HubSpot, Google APIs work via client_credentials without manual token management
  - [ ] Token refresh is invisible to Claude

### 1.4.0 — Resilience
Theme: production-grade, survives restarts

Features:
- Persistent state: save/restore loadedApis + savedWorkflows to ~/.blobfish/state.json
- responseCache proactive eviction + MAX_CACHE_SIZE cap with LRU
- reload_config meta-tool (trigger manual blobfish.json reload from Claude)
- Rate limit queuing (don't block entire session, queue per-API)
- Response field filtering: load_api(response_fields: ["id", "name"]) — jq-style

Done when:
  - [ ] Restarting Claude Desktop doesn't lose loaded APIs
  - [ ] Cache never grows unbounded

### 1.5.0 — GraphQL
Theme: double the number of APIs Blobfish can reach

Features:
- GraphQL introspection → MCP tools (one tool per Query + Mutation)
- Typed input schemas from GraphQL types
- Auto-discovery: probe for /graphql endpoint in discover_api
- Registry entries: GitHub v4, Shopify Storefront, Linear (GraphQL-first)
- Postman environment file support (resolve {{baseUrl}} and {{apiKey}} variables)

Done when:
  - [ ] load_api("https://api.github.com/graphql") produces working tools
  - [ ] All 3 GraphQL registry entries work end to end

### 1.6.0 — MCP Spec Completeness
Theme: first-class MCP citizen

Features:
- MCP Resources: expose loaded API specs as readable resources
- MCP Prompts: expose saved workflows as reusable prompts
- Streaming response support (chunked transfer)
- Web dashboard (--dashboard flag, localhost UI showing loaded APIs, request log, cache stats)

Done when:
  - [ ] Claude can read the Stripe OpenAPI spec as an MCP resource
  - [ ] Saved workflows appear in Claude's prompt menu

### 1.7.0 — Developer Experience
Theme: remove every remaining barrier

Features:
- curl → tool conversion (paste any curl command, get an MCP tool)
- Project-awareness: read package.json deps, auto-load matching registry entries
- Webhook receiver: local HTTP endpoint that surfaces webhooks as tool results
- Environment profiles (if not done in 1.3)

Done when:
  - [ ] A developer with stripe npm package installed gets Stripe tools without any config

### 2.0.0 — The Platform Release
Theme: Blobfish becomes invisible infrastructure

Breaking changes:
- New blobfish.json v2 schema (backward compat layer included)
- Meta-tool names reviewed for consistency
- Minimum Node.js bumped to 20

Features bundled from 1.x that are now stable:
- Auto-.env loading
- OAuth 2.0
- GraphQL
- Persistent state
- Project-awareness

New in 2.0:
- Browser extension: "Add to Claude" button on any API docs page
- Plugin system for custom loaders (WASM, gRPC, custom formats)
- Full MCP spec compliance certification

Done when:
  - [ ] A developer can go from zero to calling a live API in Claude in under 10 seconds with no config
  - [ ] Blobfish passes MCP conformance tests
  - [ ] Browser extension published to Chrome Web Store and Firefox Add-ons

---

## Deliberately deferred

| Idea | Why deferred | Revisit when |
|------|-------------|--------------|
| TypeScript rewrite | No user value, high churn risk | 2.0 if codebase grows complex |
| Multiple simultaneous transports | Edge case, adds complexity | If users ask |
| Self-hosted registry server | Scope creep | After 2.0 |
| gRPC support | Small audience | After GraphQL proves the pattern |
