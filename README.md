# Blobfish

**Any OpenAPI spec. Zero config. Claude-ready.**

Blobfish is an MCP server that turns any OpenAPI/Swagger spec into a full suite of Claude-callable tools — at runtime, mid-conversation, with no manual adapter writing.

Point it at a spec URL. Blobfish fetches it, parses every endpoint, and generates typed MCP tools with names, descriptions, and input schemas. Claude can immediately discover, reason about, and call any endpoint in that API.

---

## Install

```bash
git clone <repo>
cd blobfish
npm install
```

Requires Node.js 18+.

---

## Run

```bash
node server.js                                          # start with just meta-tools
node server.js https://petstore.swagger.io/v2/swagger.json   # preload a spec at startup
```

---

## Connect to Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "blobfish": {
      "command": "node",
      "args": ["C:/path/to/blobfish/server.js"],
      "env": {
        "API_KEY": "your-bearer-token-if-needed"
      }
    }
  }
}
```

Restart Claude Desktop after saving. Blobfish connects automatically.

---

## How it works

Blobfish starts with 3 meta-tools Claude can always call:

| Tool | Args | What it does |
|------|------|-------------|
| `load_api` | `spec_url`, optional `name` | Fetch any OpenAPI spec, generate all its tools instantly |
| `list_apis` | — | See what APIs are loaded and how many tools each has |
| `unload_api` | `name` | Remove an API and all its tools |

When Claude calls `load_api`, Blobfish parses the spec, registers tools prefixed with the API name, and sends a `tools/list_changed` notification — Claude sees the new tools immediately without restarting.

Multiple APIs can be loaded simultaneously. Tool names are prefixed to avoid collisions:
- `petstore_get_pets`
- `weather_get_forecast`
- `github_get_repos`

---

## Auth

Set `API_KEY` in env for global Bearer token auth:

```bash
API_KEY=sk-... node server.js
```

Per-endpoint header parameters (e.g. `X-Api-Key`) are also exposed as tool input fields automatically via the spec's parameter definitions.

---

## Demo APIs (no key required)

```bash
# Swagger 2.0
node server.js https://petstore.swagger.io/v2/swagger.json

# OpenAPI 3.0
node server.js https://petstore3.swagger.io/api/v3/openapi.json
```

---

## Built with

- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) — `@modelcontextprotocol/sdk`
- [swagger-parser](https://github.com/APIDevTools/swagger-parser) — `@apidevtools/swagger-parser`
- Node.js 18+ native `fetch`
