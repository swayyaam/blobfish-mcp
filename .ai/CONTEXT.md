# Blobfish MCP — Product Context

Last updated: 2026-05-27

## What it is

Blobfish is an MCP server that turns any REST API into Claude-callable tools — instantly, at runtime, with zero manual adapter writing. Point it at an OpenAPI/Swagger URL or a Postman collection and every endpoint becomes a typed MCP tool Claude can discover and call.

## The vision (decided 2026-05-27)

The current experience requires knowing what MCP is, what OpenAPI is, and manually calling load_api. That's a small audience.

The target experience is:
  A developer opens their project in Cursor. They type "send a Stripe invoice to the last customer."
  Claude does it. No setup. No config. No load_api call. Blobfish saw STRIPE_SECRET_KEY in .env
  and silently loaded the Stripe tools at startup. The developer never knew MCP existed.

Core insight from Zepto's CEO (YC Startup School India 2026):
  Think of the best experience you can possibly give a developer — completely unimaginable and crazy —
  then work back from there.
  The best experience isn't "easy to configure." It's "nothing to configure."

## The reframe

1.x: "Give me a spec and I'll make tools."
2.0: "I watch your project and give Claude the tools it needs before you ask."

## Target user (expanded)

Primary: any developer who has API keys in their .env file. They don't need to know what MCP is.
Secondary: power users who want to connect Claude to arbitrary APIs.
Not: developers who will write their own 50-line MCP servers.

## What makes it different from competitors

- openapi-mcp-server, mcp-openapi-proxy, mcp-openapi all exist but require manual config
- Blobfish has: auto-discovery (just a domain), registry (load by name), workflows, HTTP transport, Postman support
- 2.0 target: auto-.env loading, project-awareness, curl→tool — nobody else does this

## Distribution strategy

1. Viral demo video (60s): domain → Claude calling live API in 10 seconds
2. "Postman collections with Claude" blog post (millions of Postman users, untapped)
3. Listed on: mcp.so, Awesome MCP servers, Smithery, Anthropic examples page
4. Auto-.env feature: zero config = zero barrier = word of mouth
