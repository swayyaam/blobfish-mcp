# Blobfish MCP

[![npm version](https://img.shields.io/npm/v/blobfish-mcp)](https://www.npmjs.com/package/blobfish-mcp)
[![CI](https://github.com/swayam-mishra/blobfish-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/swayam-mishra/blobfish-mcp/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/blobfish-mcp)](LICENSE)
[![node](https://img.shields.io/node/v/blobfish-mcp)](package.json)

**Any OpenAPI spec. Zero config. Claude-ready.**

Blobfish is an MCP server that turns any REST API into Claude-callable tools — instantly, at runtime, with no manual adapter writing.

Point it at an OpenAPI/Swagger URL or a Postman collection. Blobfish parses every endpoint and generates typed MCP tools with names, descriptions, and input schemas. Claude can immediately discover, reason about, and call any endpoint — authenticated, parameterized, and live.

---

## Demo

> *"I pointed it at a domain name. It found the spec itself, loaded 20 tools, and Claude was querying a live API in 10 seconds."*

![Blobfish demo](https://raw.githubusercontent.com/swayam-mishra/blobfish-mcp/main/assets/demo.gif)

---

## Install

```bash
# Run directly without installing
npx blobfish-mcp https://petstore.swagger.io/v2/swagger.json

# Configure Claude Desktop (no clone needed)
npx blobfish-mcp --setup

# Or install globally
npm install -g blobfish-mcp
blobfish https://petstore.swagger.io/v2/swagger.json
```

Requires Node.js 18+.

---

## Connect to Claude Desktop

The fastest way — no clone required:

```bash
npx blobfish-mcp --setup
```

Or if you've cloned the repo:

```bash
npm install
npm run setup   # auto-detects config path and writes the entry
```

Then reload MCP config in Claude Desktop: **Help → Reload MCP Configuration**.

### Manual setup

Add to your Claude Desktop config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "blobfish": {
      "command": "node",
      "args": ["/path/to/blobfish-mcp/server.js"],
      "env": {
        "API_KEY": "your-bearer-token-if-needed"
      }
    }
  }
}
```

---

## Compatible clients

Works with any MCP-compatible client:

- **Claude Desktop** — primary target, setup via `npx blobfish-mcp --setup`
- **Cursor** — add to `.cursor/mcp.json` using the same config format
- **Windsurf** — add to `~/.codeium/windsurf/mcp_config.json`
- **Continue.dev** — add to `.continue/config.json` under `mcpServers`
- **Cline / Roo Cline** — add via Cline's MCP settings panel
- **Zed** — add to Zed's MCP settings
- **Smithery** — one-click install via `smithery.yaml`

For clients that use HTTP/SSE instead of stdio, start with:
```bash
blobfish --http   # Streamable HTTP on http://localhost:3000/mcp
blobfish --sse    # SSE on http://localhost:3000/sse
BLOBFISH_PORT=8080 blobfish --http   # custom port
```

---

## How it works

Blobfish starts with **15 meta-tools** Claude can always call:

| Tool | Description |
|------|-------------|
| `list_registry` | List all pre-configured APIs — load any by name instantly |
| `discover_api` | Auto-find a spec from just a domain — probes 15 common paths |
| `load_api` | Load by URL, registry name, or local file. Supports `include_tags`, `exclude_tags`, `shallow`, `mock` |
| `set_api_auth` | Update credentials for a loaded API mid-conversation |
| `fetch_all` | Auto-paginate any endpoint — Link headers, cursor, offset |
| `run_workflow` | Multi-step pipelines with `{{ template }}` syntax, `foreach`, and `run_if` |
| `get_last_request_log` | See the exact URL/body of the last N requests — use when debugging 400 errors |
| `rate_limit_status` | Show which APIs are rate-limited and when they reset |
| `cache_stats` | Cache hit rate, size, and entries |
| `clear_cache` | Clear cached responses |
| `test_connection` | Ping a loaded API and get status + response time |
| `inspect_tool` | Show the full input schema of any loaded tool |
| `api_summary` | Plain-English overview of a loaded API by capability group |
| `list_apis` | List all loaded APIs and tool counts |
| `unload_api` | Remove a loaded API and all its tools |

When Claude calls `load_api` or `discover_api`, Blobfish parses the spec and sends a `tools/list_changed` notification — new tools appear immediately.

---

## Workflows

Chain multiple API calls into a single operation. Reference earlier step results with `{{ steps.id.field }}` template syntax.

**Run inline:**
```
run_workflow(steps: [
  { id: "user",  tool: "jph_get_users_id",       args: { id: "1" } },
  { id: "posts", tool: "jph_get_posts",           args: { userId: "{{ steps.user.data.id }}" } },
  { id: "first_comments", tool: "jph_get_posts_id_comments",
    run_if: "{{ steps.posts.data.length }} != 0",
    args:   { id: "{{ steps.posts.data.0.id }}" } }
])
```

**Save and re-run:**
```
save_workflow(name: "user-posts", steps: [...])
run_workflow(name: "user-posts", input: { userId: "42" })
list_workflows()
```

**Pre-load from blobfish.json:**
```json
{
  "workflows": {
    "crypto-report": {
      "description": "BTC/ETH prices + trending coins",
      "steps": [
        { "id": "price",    "tool": "coingecko_get_simple_price",    "args": { "ids": "{{ input.coins }}", "vs_currencies": "usd" } },
        { "id": "trending", "tool": "coingecko_get_search_trending", "args": {} }
      ]
    }
  }
}
```

Per-step options: `foreach` (iterate over an array), `run_if` (conditional skip), `on_error: "continue"` (don't abort on failure).

Ready-to-use examples are in the [`workflows/`](workflows/) folder.

---

## blobfish.json config

Pre-configure APIs to load at startup. Create `blobfish.json` in the project root:

```json
{
  "timeout": 30000,
  "retries": 3,
  "apis": [
    {
      "url": "https://petstore.swagger.io/v2/swagger.json",
      "name": "petstore"
    },
    {
      "url": "https://api.example.com/openapi.json",
      "name": "myapi",
      "auth": {
        "type": "bearer",
        "key": "${MY_API_TOKEN}"
      },
      "timeout": 10000
    },
    {
      "url": "./local-spec.json",
      "name": "localapi",
      "mock": true
    }
  ]
}
```

Values like `"${MY_API_TOKEN}"` are interpolated from environment variables at startup.

---

## Authentication

### Per-API auth in blobfish.json or via `load_api`

```json
{ "type": "bearer", "key": "sk-..." }

{ "type": "apikey", "key": "abc123", "header": "X-Api-Key" }

{ "type": "basic", "username": "user", "password": "pass" }
```

### Global fallback

Set `API_KEY` in your environment or `.env` file for Bearer token auth across all APIs.

---

## Pagination

Use `fetch_all` to automatically retrieve all pages from a paginated endpoint:

```
fetch_all(tool_name: "petstore_get_pets", args: { status: "available" }, max_pages: 5)
```

Blobfish automatically detects and follows:
- `Link: <url>; rel="next"` headers (GitHub, Stripe style)
- `{ next_cursor, cursor, after, next_page_token }` fields
- `{ has_more: true }` + offset/limit
- `{ total, offset, limit }` patterns

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_KEY` | — | Global Bearer token for all APIs |
| `BLOBFISH_TIMEOUT` | `30000` | Request timeout in ms |
| `BLOBFISH_RETRIES` | `3` | Retry attempts on 5xx errors |
| `BLOBFISH_LOG` | — | Log file path, or `true` for `./blobfish.log` |
| `BLOBFISH_PORT` | `3000` | Port for `--http` / `--sse` transports |

---

## Mock mode

Load an API in mock mode to get example responses without making real HTTP calls — useful for testing or demoing without API keys:

```
load_api(spec_url: "https://...", mock: true)
```

Responses are generated from the `example` fields in the OpenAPI spec.

---

## Supported formats

- OpenAPI 3.x (JSON + YAML)
- Swagger 2.0 (JSON + YAML)
- Postman Collections v2.1
- Local files (`./path/to/spec.json`)

---

## Troubleshooting

**Blobfish doesn't appear in Claude Desktop**
- Make sure you fully quit Claude Desktop (tray icon → Quit), not just close the window
- On Windows Store install, config goes in `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\claude_desktop_config.json` — run `npm run setup` to find the right path automatically
- Check that `node` is in PATH: open a terminal and run `node --version`. If it fails, use the full path (`C:/Program Files/nodejs/node.exe`) in the config's `command` field

**`SSRF blocked` error when loading a spec**
- The spec URL resolves to a private/internal IP. This is intentional for security.
- If you're loading a local spec during development: set `BLOBFISH_ALLOW_LOCAL=true` in your `.env`

**`Spec generates N tools (max 500)` error**
- Use `include_tags` to filter: `load_api(spec_url: "...", include_tags: ["repos", "issues"])`
- Run `api_summary` first to see what tags are available

**Tools appear but calls return errors**
- Call `get_last_request_log` after the failed call — Claude can see the exact URL and body sent and self-correct
- Check `rate_limit_status` — you may be waiting for a rate limit to reset

---

## Built with

- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — `@modelcontextprotocol/sdk`
- [swagger-parser](https://github.com/APIDevTools/swagger-parser) — `@apidevtools/swagger-parser`
- Node.js 18+ native `fetch`
- [dotenv](https://github.com/motdotla/dotenv)

