# Status

Last updated: 2026-06-06

## Current milestone

1.3.0 — OAuth
Goal: unlock enterprise APIs (Salesforce, HubSpot, Google) that require OAuth 2.0 client_credentials.

## Recently completed

- 1.2.0 shipped (2026-06-06) — Zero Config
  - Auto-.env loading: registry APIs whose env vars are present load silently at startup (on by default, BLOBFISH_AUTO_LOAD=false to disable)
  - Tool annotations: readOnlyHint/destructiveHint/idempotentHint/openWorldHint inferred from HTTP method
  - evaluateCondition: added >, <, >=, <= numeric comparison operators
  - SPEC_PROBE_PATHS expanded (20 → 21 paths, added .yml variants, /.well-known/openapi.json, /spec/)
  - npm bin: added blobfish-mcp alias so npx blobfish-mcp works without warning
  - Server version bumped to 1.2.0
- 1.1.0 shipped to npm (2026-05-27)
  - 13 improvements: version fix, savedWorkflows bug, Postman double-fetch, findDataArray priority
  - New tools: save_workflow, list_workflows
  - New flags: --setup, --http, --sse
  - 10 new registry entries (21 total)
  - CONTRIBUTING.md, CI hardening, Node 24 Actions

## In progress

Nothing currently in progress.

## Up next (1.3.0)

- [ ] OAuth 2.0 client_credentials flow (client_id + client_secret → auto-fetch bearer token)
- [ ] Token auto-refresh before expiry
- [ ] Per-API auth profiles in blobfish.json (staging vs production keys)
- [ ] Environment profiles: --profile staging loads a different blobfish.json

## Open questions (need Swayam's decision)

- [ ] For 1.3.0 OAuth: should client_credentials tokens be stored in state.json (persistent) or memory-only?
      Recommendation: memory-only for now, persistent in 1.4.0 alongside full state persistence.
