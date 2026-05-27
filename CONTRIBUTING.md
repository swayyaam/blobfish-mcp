# Contributing to Blobfish MCP

Thanks for wanting to help. Contributions of all sizes are welcome — from a new registry entry (a single JSON file) to new features.

---

## Quickstart

```bash
git clone https://github.com/swayam-mishra/blobfish-mcp
cd blobfish-mcp
npm install
npm test        # run the test suite
```

Node.js 18+ required.

---

## The easiest contribution: add a registry entry

A registry entry lets anyone load a well-known API with a single command:
```
load_api("stripe")
```

Each entry is just a JSON file in `registry/`. To add one:

1. Create `registry/<api-name>.json` — name must be lowercase, no spaces.

2. Required fields:
   ```json
   {
     "name": "myapi",
     "title": "My API",
     "spec_url": "https://example.com/openapi.json"
   }
   ```

3. Optional fields:
   ```json
   {
     "description": "One-line description shown in list_registry.",
     "include_tags": ["Pets", "Users"],
     "exclude_tags": ["Internal"],
     "shallow": false,
     "mock": false,
     "auth": {
       "type": "bearer",
       "key": "${MY_API_KEY}"
     },
     "notes": "Shown to the user when auth env var is missing. Include where to get the key."
   }
   ```

4. Auth types: `bearer`, `apikey` (+ `header`), `basic` (+ `username`, `password`), `none`.
   Use `${ENV_VAR_NAME}` placeholders — they are interpolated from environment at runtime.

5. If the spec has more than 500 endpoints, use `include_tags` to filter it down.
   Run `api_summary("name")` in Claude after loading to see available tags.

6. Test your entry locally:
   ```bash
   node server.js
   # then in Claude: load_api("myapi")
   ```

7. Open a PR. The CI pipeline will validate your JSON automatically.

---

## Adding a workflow example

Workflows live in `workflows/`. Each is a JSON file with this shape:

```json
{
  "_description": "What this workflow does.",
  "_setup": "load_api('...') — what the user needs to run first",
  "steps": [
    { "id": "step1", "tool": "api_get_something", "args": { "id": "{{ input.id }}" } },
    { "id": "step2", "tool": "api_post_other",    "args": { "body": { "ref": "{{ steps.step1.data.id }}" } } }
  ],
  "input": { "id": "example-default" }
}
```

Template syntax: `{{ input.field }}`, `{{ steps.id.data.field }}`, `{{ steps.id.status }}`.
Per-step options: `foreach`, `run_if`, `on_error: "continue"`.

---

## Code changes

### Project layout

```
server.js          — MCP server entry point, startup, transport selection
setup.js           — Claude Desktop auto-config (also: npx blobfish-mcp --setup)
src/
  constants.js     — env vars, limits, probe paths
  state.js         — shared in-memory Maps (loadedApis, cache, etc.)
  security.js      — SSRF guard, path traversal, error sanitisation
  http.js          — executeRequest, withRetry
  cache.js         — response cache get/set/stats
  ratelimit.js     — rate limit tracking and waiting
  pagination.js    — detectNextPage, findDataArray
  workflow.js      — template resolution, condition evaluation
  utils.js         — slugify, buildAuthHeaders, buildInputSchema, mock helpers
  registry.js      — getAllTools, findHandler, makeUniqueName
  loaders/
    auto.js        — sniff format and dispatch to openapi/postman loader
    openapi.js     — parse OpenAPI/Swagger spec → tools
    postman.js     — parse Postman collection → tools
    probe.js       — auto-discover spec URL from a domain
    registry.js    — read registry/*.json files
  tools/
    meta.js        — MCP tool definitions for the 17 meta-tools
    handlers.js    — handler logic for every meta-tool
registry/          — pre-configured API entries (JSON)
workflows/         — example multi-step workflow files (JSON)
test/
  basic.test.js    — unit tests (node:test, no test runner needed)
```

### Running tests

```bash
npm test
```

Tests use Node's built-in `node:test` runner. No Jest, no Mocha.

### Code style

- ESM throughout (`import`/`export`, no `require`)
- No TypeScript — plain JS with JSDoc where helpful
- No formatter config — keep the style consistent with surrounding code
- Security: all external URLs go through `assertSafeUrl()`, all local paths through `assertSafeLocalPath()`
- New meta-tools need an entry in both `src/tools/meta.js` (schema) and `src/tools/handlers.js` (logic)

### PR checklist

- [ ] `npm test` passes
- [ ] `node --check server.js` and `find src -name '*.js' | xargs node --check` pass
- [ ] New registry entries have `name`, `title`, and `spec_url`
- [ ] New env vars are documented in README env table and `.env.example`
- [ ] No new dependencies unless genuinely necessary (keep the install size small)

---

## Reporting bugs

Open an issue at https://github.com/swayam-mishra/blobfish-mcp/issues.

Include:
- What you ran (`npx blobfish-mcp ...` or config JSON)
- What spec URL or registry name you used
- The error message (redact any API keys)
- Output of `get_last_request_log` if the error came from an API call

---

## Questions

Open a Discussion on GitHub. PRs are welcome without prior discussion for registry entries and bug fixes. For large features, open an issue first so we can align on approach.
