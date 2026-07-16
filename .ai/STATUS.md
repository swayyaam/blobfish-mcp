# Status

Last updated: 2026-07-16

## Current milestone

1.3.0 — OAuth
Goal: unlock enterprise APIs (Salesforce, HubSpot, Google) that require OAuth 2.0 client_credentials.

## In progress

1.3.0 is code-complete on `dev`, pending review + release:

- [x] OAuth 2.0 client_credentials flow (src/oauth.js) — client_id + client_secret → auto-fetch bearer token
  - Tokens cached in memory per token_url|client_id|scope, single-flight on concurrent calls
  - Supports scope, audience, and client_auth: "body" (default) or "basic"
  - token_url goes through assertSafeUrl (SSRF), secrets never logged
- [x] Token auto-refresh: refetch 60s before expiry; one automatic retry with a fresh token on 401
- [x] Per-API auth profiles: `auth_profiles: { staging: {...} }` on blobfish.json entries (src/config.js selectAuth)
- [x] Environment profiles: `--profile staging` / `BLOBFISH_PROFILE=staging` loads blobfish.staging.json if present, else blobfish.json with auth_profiles.staging selected
- [x] Fixed: positional-arg loop no longer treats --http/--sse/--profile as spec URLs (src/config.js parseArgs)
- [x] AUTH_SCHEMA extended with oauth2 fields; registry unresolved-auth error tailored for oauth2
- [x] Version bumped to 1.3.0 (package.json + server.js)
- [x] 16 new tests (91 total, all passing); docs updated (README, blobfish.example.json, .env.example)

Not verified live (needs real credentials): Salesforce/HubSpot/Google end-to-end via client_credentials.

## Recently completed

- 1.2.0 shipped (2026-06-06) — Zero Config
  - Auto-.env loading: registry APIs whose env vars are present load silently at startup (on by default, BLOBFISH_AUTO_LOAD=false to disable)
  - Tool annotations: readOnlyHint/destructiveHint/idempotentHint/openWorldHint inferred from HTTP method
  - evaluateCondition: added >, <, >=, <= numeric comparison operators
  - SPEC_PROBE_PATHS expanded (20 → 21 paths, added .yml variants, /.well-known/openapi.json, /spec/)
  - npm bin: added blobfish-mcp alias so npx blobfish-mcp works without warning
- 1.1.0 shipped to npm (2026-05-27)

## Up next (1.4.0 — Resilience)

- [ ] Persistent state: save/restore loadedApis + savedWorkflows to ~/.blobfish/state.json
- [ ] responseCache proactive eviction + MAX_CACHE_SIZE cap with LRU
- [ ] reload_config meta-tool
- [ ] Rate limit queuing per-API
- [ ] Response field filtering: load_api(response_fields: [...])

## Open questions (need Swayam's decision)

- [ ] Should 1.4.0 state persistence include oauthTokens? (1.3.0 keeps them memory-only per DECISIONS.md — a restart just refetches, which is cheap. Persisting tokens to disk is a security tradeoff.)
- [ ] Growth roadmap (repo-root ROADMAP.md, untracked) suggests pulling progressive tool disclosure forward — decide before scoping 1.4.0 vs 1.5.0.
