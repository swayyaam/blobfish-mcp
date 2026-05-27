# Status

Last updated: 2026-05-27

## Current milestone

1.2.0 — Zero Config
Goal: if the API key is in your .env, Blobfish loads that API automatically. No blobfish.json needed.

## Recently completed

- 1.1.0 shipped to npm (2026-05-27)
  - 13 improvements: version fix, savedWorkflows bug, Postman double-fetch, findDataArray priority
  - New tools: save_workflow, list_workflows
  - New flags: --setup, --http, --sse
  - 10 new registry entries (21 total)
  - CONTRIBUTING.md, CI hardening, Node 24 Actions
- Cleaned up all .ai/ placeholder files with real content (2026-05-27)

## In progress

Nothing currently in progress.

## Up next (1.2.0)

- [ ] Auto-load from .env — scan known env var names at startup, silently load matching registry entries
- [ ] npm pkg fix — clean the bin script name warning
- [ ] Tool annotations — readOnly/destructive/idempotent inferred from HTTP method
- [ ] Fix evaluateCondition — add >, <, >=, <= support
- [ ] Expand SPEC_PROBE_PATHS

## Open questions (need Swayam's decision)

- [ ] Should auto-.env loading be opt-in (BLOBFISH_AUTO_LOAD=true) or opt-out (BLOBFISH_AUTO_LOAD=false)?
      Recommendation: opt-out (on by default) — fits the zero-config philosophy.
      But some users might not want their keys auto-used. Worth deciding before building.

- [ ] For 1.3.0 OAuth: should client_credentials tokens be stored in state.json (persistent) or memory-only?
      Recommendation: memory-only for now, persistent in 1.4.0 alongside full state persistence.
