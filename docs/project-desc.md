# Blobfish
*Any API. Zero config. Claude-ready.*

Blobfish is an MCP server that dynamically converts any OpenAPI/Swagger specification into a full suite of Claude-callable tools — in real time, with no manual adapter writing.

Point it at a Swagger URL. Blobfish fetches the spec, parses every endpoint, and auto-generates MCP tool definitions complete with names, descriptions, and input schemas. Claude can immediately discover, reason about, and call any endpoint in that API — authenticated, parameterized, and live.

---

## The problem it solves

Every SaaS product has an API. Almost none of them are natively accessible to AI agents today. Building MCP adapters by hand is repetitive, time-consuming, and doesn't scale. The result: thousands of tools the agentic web can't reach yet.

Blobfish eliminates that gap entirely.

---

## How it works

1. Claude calls `load_api` with any OpenAPI spec URL
2. Blobfish fetches and parses the spec at runtime
3. Every path and operation becomes a typed, callable MCP tool
4. Claude executes real HTTP requests — with path params, query params, request bodies, and auth headers reconstructed automatically
5. A `tools/list_changed` notification fires — Claude sees the new tools instantly, mid-conversation

One server. Any API. Claude loads them itself.

---

## What makes it different

Most MCP servers have tools hardcoded by the developer — one adapter per API, written by hand.

Blobfish generates tools at runtime from the spec. Any API with an OpenAPI spec is instantly agent-accessible. No SDK. No wrapper. No glue code.

It also supports loading multiple APIs simultaneously in the same session, with tool names prefixed per API to avoid collisions.

---

## Built on

- Node.js
- MCP SDK (`@modelcontextprotocol/sdk`)
- swagger-parser (`@apidevtools/swagger-parser`)
- Claude API (Claude Desktop)

---

## Why it matters

This is foundational agentic infrastructure. Any developer who wants their API to be agent-accessible gets it instantly. Blobfish is the missing adapter layer between the existing API economy and the agentic web.
