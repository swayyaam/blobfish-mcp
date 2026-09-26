# Blobfish Roadmap — The Universal API Layer

> Version-by-version engineering scope lives in [.ai/ROADMAP.md](.ai/ROADMAP.md).
> This is the vision document: the bets worth making, and why each one is possible.

**Current state:** v1.3.0 shipped 2026-07-17 (OAuth 2.0 client_credentials + environment profiles).
Next milestone: 1.4.0.

---

## North star

Today's north star — *"a developer should never have to configure anything"* — is correct
but too small. It describes a better installer. The real target is one level up:

> **Every API on earth is already a Claude tool. There is nothing to install, nothing to
> configure, and no such thing as an API that isn't supported.**

A developer has keys in `.env`. Claude has the tools. Nobody ever writes a spec URL,
nobody calls `load_api`, nobody learns what MCP is, and "does it support X?" stops
being a question anyone asks — because the answer is structurally always yes.

Everything below is a bet on making that literal.

---

## The five bets

Ordered by how much they change what Blobfish *is*, not by engineering effort.

### Bet 1 — One tool, forever

**The problem, stated honestly:** loading the GitHub spec produces hundreds of tools.
Progressive disclosure (register a `search_endpoints` + `call_endpoint` pair, materialize
on demand) *mitigates* this. It doesn't kill it.

**The crazy version:** Blobfish exposes **one tool**, regardless of how many APIs are loaded.

```
blobfish(intent: "create a Stripe invoice for $400 to acme@co")
```

Claude expresses intent. Blobfish does retrieval over an endpoint index, picks the
endpoint, binds the parameters, calls it, returns the result. Tool count is **O(1) in the
number of APIs.** Load all 21 registry entries and the client's context cost is one tool
schema. Load 500 APIs and it's still one.

**Why it's actually possible:** this is `search_endpoints` from the old §1.1, minus the
materialization step. The retrieval half is keyword scoring over
`summary + operationId + path`, which is a weekend. Embeddings only if scoring proves weak.

**The honest risk, and the fix:** Claude is measurably better at calling a well-typed tool
than at describing intent in prose — you lose real JSON Schema, which is the thing that
makes tool calls reliable. So the shipping version is a **hybrid**: one tool by default,
and the moment an endpoint is used, Blobfish materializes the real typed tool for it and
fires `tools/list_changed`. Context cost stays proportional to what's *in use*, not to what
*exists*. That's still the whole ballgame, and it's honest about where LLMs are strong.

---

### Bet 2 — Kill the spec requirement

**The problem:** `discover_api` probes 25 spec paths and then gives up. Most APIs in the
world have documentation and no OpenAPI spec. Every one of them is currently out of reach.

**The crazy version:** point Blobfish at an API's **documentation page** and it synthesizes
a spec from the prose.

```
load_api("https://docs.someservice.com/api")   → working tools
```

No spec required. No registry entry required. No curl command required.

**Why it's actually possible:** turning HTML docs into a structured schema is precisely
what LLMs are good at, and Blobfish already runs inside one. It doesn't need to be perfect —
it needs to be good enough to make a first call. Bet 3 fixes everything it gets wrong.

**Why it's the biggest bet on this page:** it moves the addressable market from
*"APIs with a published spec"* to *"APIs with documentation."* That is the difference
between a niche tool and infrastructure. The registry stops being 21 curated entries and
becomes *any URL a human could read*.

`curl → tool` (old §1.6) is the degenerate case of this, and stays — paste a curl command,
get a tool. Ship it alongside, it's the same machinery pointed at a smaller input.

---

### Bet 3 — Specs are hypotheses; responses are truth

**The problem nobody in this space is solving:** every OpenAPI spec in the wild is wrong
somewhere. Undocumented required fields. Renamed params. Enums missing values. Lies about
nullability.

Today, a call fails and Blobfish hands Claude the error.

**The crazy version:** Blobfish **learns the correction and never makes the mistake again.**

```
POST /v1/invoices → 400 "unknown field `customer_email`, did you mean `email`?"
  → record the correction
  → patch the local model of the API
  → retry
  → persist to ~/.blobfish/learned.json
```

The spec is a starting hypothesis. Real responses are ground truth. After a month of use,
**Blobfish's model of an API is empirically more accurate than the vendor's published spec.**

**Why it's actually possible:** it's a JSON patch layer over the parsed spec plus error-shape
matching for the common 4xx dialects. The infrastructure lands anyway in 1.4.0 —
`~/.blobfish/state.json` persistence is already scoped; `learned.json` is the same machinery.

This is the one that would make people talk. Self-healing auth (1.1.0) was the small version
of this idea. This is the large one.

---

### Bet 4 — Corrections flow back, and the registry becomes a network

Bet 3 produces a stream of empirically-verified corrections on every user's machine.
Right now they'd die there.

**The crazy version:** they flow back. Your failed call improves the shared model for
everyone. Someone loads an API nobody has ever loaded → it's in the registry for the next
person. The registry stops being 21 hand-maintained JSON files and becomes a **live,
crowd-verified map of the public API surface** — one that gets more accurate the more
it's used.

That is a real network effect, not the fake kind. It compounds with usage rather than
with maintainer hours, which is the only kind of moat a solo-maintained project can hold.

**Prerequisites, in order:** remote registry (already deferred to post-2.0 in
[DECISIONS.md](.ai/DECISIONS.md) — this is the argument for pulling it forward), opt-in
contribution with a clear privacy line (**corrections only, never values, never URLs with
credentials, never response bodies**), and CI that smoke-tests submitted entries.

The trust work in §"Trust" below is a hard prerequisite for this bet, not a parallel track.

---

### Bet 5 — Ambient: delete `load_api` entirely

**The crazy version:** Blobfish isn't something Claude launches. It's something that *runs*.

It watches the project directory. You add `STRIPE_API_KEY` to `.env` — the Stripe tools
appear **mid-conversation**, via `tools/list_changed`, with no restart. You `npm install
linear` — Linear tools appear. You switch projects — the toolset follows.

`load_api` becomes a power-user escape hatch that a normal user never touches.

**Why it's actually possible:** auto-.env loading already ships and is on by default
(1.2.0). Project-awareness via `package.json` is already scoped for 1.7.0. What's missing
is a file watcher and a `tools/list_changed` emit — genuinely small, given what exists.

This is the north star taken literally, and it is much closer than it looks.

---

## The structural moat: cross-API

Worth stating plainly, because it determines what Blobfish should *never* compete on.

**Stripe's own MCP server will always beat Blobfish at Stripe.** Hand-tuned tools, vendor
maintained. Don't fight that; you lose.

What a single-vendor server can *never* do:

> "Every failed Stripe payment this week → look up the customer in HubSpot →
> open a Linear ticket with their plan tier."

Three APIs, one sentence, one call. Cross-API orchestration is the only ground where a
universal adapter structurally wins — and Workflows (templates, `foreach`, `run_if`)
already exist and already do this. They're currently documented as a feature bullet.

**They should be the headline.** Every demo, every landing page, every video: three APIs
in one sentence. That's the thing nobody else can copy without becoming Blobfish.

---

## Beyond REST — "anything with a schema becomes tools"

The same machinery, pointed at more protocols. Each one multiplies the addressable surface:

- **GraphQL** introspection → tools (already scoped, 1.5.0)
- **gRPC** server reflection → tools
- **SOAP/WSDL** → tools — deeply unglamorous, enormous in enterprise, and *nobody will
  build it*. Which is exactly why it's worth building.
- **Databases** — a schema is a schema. Postgres introspection → typed query tools.

Every protocol here is a schema-to-tools problem, and Blobfish is a schema-to-tools engine.

---

## What does not change

**Stay on Node.js.** Asked and answered — do not rewrite in Go, Rust, or Python.
`npx blobfish-mcp` zero-install execution *is* the zero-config story; a compiled binary
means downloads, brew formulas, and PATH problems — strictly worse onboarding. The MCP
ecosystem is TypeScript-first. The workload is I/O-bound stdio proxying, so Go's advantages
buy nothing. `@apidevtools/swagger-parser` has no equally mature Go replacement. A rewrite
is months of work, zero user-visible value, guaranteed regressions.

**TypeScript migration** stays deferred to 2.0 per [DECISIONS.md](.ai/DECISIONS.md).
JSDoc + `// @ts-check` is the cheap middle ground. At ~720 lines, the codebase has not
earned a migration.

**Trust is a prerequisite, not a phase.** An MCP server that proxies authenticated calls
lives or dies on it — and Bet 4 is unshippable without it:

- **SECURITY.md** — document the SSRF protection, local-file gating, and secret handling
  that already exist; add a disclosure policy
- **Read-only mode** (`BLOBFISH_READ_ONLY=true`) and **allowlist mode** — the two things
  every enterprise evaluation asks for
- **Widen `CRED_PARAMS`** ([src/constants.js:50](src/constants.js:50)) — header redaction
  and URL scrubbing already ship, but the credential-param list is a fixed 12 names, so
  `?auth_token=` still logs in cleartext. Small fix, do it now.
- Live CI integration tests against the public registry APIs (CoinGecko, Open-Meteo, Petstore)
- MCP conformance suite (2.0)

**Distribution compounds and is currently the binding constraint.** The product analysis
above is worth nothing if nobody sees it. Directory listings (official MCP registry,
awesome-mcp-servers, mcp.so, Glama, PulseMCP, Cline), one-click installs (`.mcpb` bundle,
Cursor deeplink, `claude mcp add` one-liner), and **SEO landing pages generated from
registry JSON** — 21 pages on day one, one per entry, targeting "Stripe MCP server" and
its long tail. That last one is roughly a day of work with a static generator and GitHub
Pages, and it is the highest-ROI item in this entire document.

---

## Why ambition and distribution stop competing

The usual objection to a document like this is that a solo maintainer should be doing
distribution, not moonshots.

That objection dissolves here, because **every bet on this page is also the most demoable
thing on it.** Each one is a 60-second video that explains itself with no narration:

| Bet | The video |
|---|---|
| 2 — docs → spec | Paste a docs URL. Call the API 10 seconds later. No spec, no config. |
| 3 — learning | Watch it fail once. Watch it never fail that way again. |
| 1 — one tool | "GitHub loaded. 900 tools." → "GitHub loaded. 1 tool." |
| 5 — ambient | Add a key to `.env` mid-conversation. The tools appear. Nothing restarts. |
| moat — cross-API | Three APIs. One sentence. One call. |

Ship a bet, ship its video, ship the listings that week. The ambition *is* the
distribution strategy. Anything on this page that can't produce that video is probably
not worth building yet.

---

## Sequencing

Each cycle pairs one bet with the distribution work it unlocks.

**1.4.0 — Foundations + the overload kill**
Persistence (`state.json`) · cache caps + LRU · `reload_config` · rate-limit queuing ·
response field filtering · **Bet 1 hybrid (one tool + materialize-on-use)** ·
widen `CRED_PARAMS` · SECURITY.md
→ *Ship alongside:* all directory listings, SEO landing pages, the 60-second demo video.

**1.5.0 — Kill the spec requirement**
**Bet 2 (docs → spec)** · `curl → tool` · GraphQL introspection · Postman env files
→ *Ship alongside:* Show HN. "Your .env is now Claude tools" is HN-shaped, and Bet 2 is
the thing that makes it undeniable.

**1.6.0 — The learning layer**
**Bet 3 (learned corrections)** · MCP Resources (specs) · MCP Prompts (workflows) ·
elicitation for missing credentials · streaming
→ *Ship alongside:* the "specs are wrong and we fix them" writeup.

**1.7.0 — Ambient**
**Bet 5 (file watching, `tools/list_changed`, project-awareness)** · webhook receiver
→ *Ship alongside:* the mid-conversation-tools-appear video.

**2.0 — The network**
**Bet 4 (remote registry, corrections flow back)** · blobfish.json v2 · Desktop Extension
bundle · browser extension · MCP conformance · read-only + allowlist modes

**Post-2.0** — gRPC, SOAP/WSDL, databases. "Anything with a schema."

---

## Metrics

Lagging indicators (stars, downloads) can't steer a decision. These can:

| Metric | Now | Target |
|---|---|---|
| % of `npx` runs that make ≥1 successful API call | unknown — **instrument first** | 80% |
| APIs reachable with no published spec | 0 | unbounded (Bet 2) |
| Median tools registered per loaded API | hundreds | 1 (Bet 1) |
| Learned corrections in the shared registry | 0 | 1,000+ (Bets 3+4) |
| Cross-API workflows executed | untracked | the primary usage mode |
| Registry entries | 21 | 60+, half community |
| Directory listings | 1 (Smithery) | 6 |

The first row is the only one that matters before any of the rest. **Instrument it in
1.4.0** — everything else is a guess until you know how many people get to a working
API call and how many bounce.
