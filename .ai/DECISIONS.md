# Decisions

Last updated: 2026-05-27

A log of product and technical decisions made, with reasoning. Prevents relitigating the same questions.

---

## 2026-05-27 — Versioning: sync server.js to package.json not the other way

Decision: server.js internal version was 8.0.0, package.json was 1.0.0 (the npm public version).
Synced server.js DOWN to 1.0.0 to match npm.
Reason: npm version is the public-facing number. Internal numbers don't matter.
Bumped to 1.1.0 for the first feature release.

---

## 2026-05-27 — Transport: stdio default, HTTP/SSE opt-in via flags

Decision: keep stdio as default transport. HTTP (--http) and SSE (--sse) are opt-in flags.
Reason: 95% of users are on Claude Desktop or Cursor which use stdio. HTTP adds an open port
which is a security concern for users who don't need it. Opt-in is safer.

---

## 2026-05-27 — Workflow storage: support both inline steps and named saved workflows

Decision: run_workflow accepts either inline steps array OR a name that looks up savedWorkflows.
save_workflow stores to in-memory savedWorkflows map.
blobfish.json workflows key populates savedWorkflows at startup.
Reason: three natural ways to use workflows — all should work.

---

## 2026-05-27 — Vision: zero-config is the north star

Decision: the long-term product goal is that developers should never need to call load_api manually.
Blobfish watches the project (.env, package.json) and makes relevant APIs available automatically.
Inspired by: Zepto CEO at YC Startup School India 2026 — "think of the best possible experience,
completely unimaginable, then work back from there."
Implication: every feature decision should ask "does this reduce configuration required?"

---

## 2026-05-27 — Auto-.env loading: on by default (opt-out)

Decision: PENDING (see STATUS.md open questions)
Options: opt-in (BLOBFISH_AUTO_LOAD=true) vs opt-out (default on, BLOBFISH_AUTO_LOAD=false)
Leaning toward: opt-out (on by default) — fits zero-config philosophy

---

## 2026-05-27 — Registry approach: flat JSON files, no central server

Decision: registry entries are flat JSON files in registry/ directory, shipped with the package.
No central registry server, no network request to load the registry list.
Reason: simplicity, works offline, no dependency on external service uptime.
Tradeoff: users must update npm package to get new registry entries.
Future: consider a remote registry that Blobfish checks for updates (post-2.0).

---

## 2026-05-27 — GraphQL: 1.5.0 not sooner

Decision: GraphQL support is important but deferred to 1.5.0.
Reason: OAuth (1.3.0) unlocks more immediate user pain. GraphQL is complex to get right.
The 1.2-1.4 versions build the foundation (auth, persistence) that GraphQL needs anyway.

---

## 2026-05-27 — Postman environment files: 1.5.0

Decision: Postman {{variable}} resolution from environment files deferred to 1.5.0.
Reason: same release as GraphQL — both are about expanding the "what can Blobfish load" surface.
Current workaround: users can pre-substitute variables in the collection before loading.
