# Status

Last updated: 2026-07-17

## Current milestone

1.4.0 — Resilience
Goal: production-grade, survives restarts (persistent state, cache caps, rate limit queuing).

## In progress

Nothing currently in progress. 1.4.0 not yet started.

## Recently completed

- 1.3.0 shipped to npm (2026-07-17) — OAuth
  - OAuth 2.0 client_credentials flow (src/oauth.js): auth type "oauth2" with token_url/client_id/client_secret (+ scope, audience, client_auth body|basic)
  - Tokens memory-only, keyed token_url|client_id|scope, single-flight; refreshed 60s before expiry; one auto-retry with fresh token on 401
  - Environment profiles: --profile staging / BLOBFISH_PROFILE loads blobfish.staging.json if present, selects auth_profiles.staging on entries (src/config.js)
  - Fix: CLI flags no longer treated as positional spec URLs
  - 16 new tests (91 total); GitHub release: https://github.com/swayam-mishra/blobfish-mcp/releases/tag/v1.3.0
  - Not verified live (needs real credentials): Salesforce/HubSpot/Google end-to-end via client_credentials
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
