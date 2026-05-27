# Principles

Last updated: 2026-05-27

These are the non-negotiables. Every PR, feature, and decision should be checked against these.

---

## 1. Zero config beats easy config

The best experience is nothing to configure, not "easy to configure."
Every feature should ask: can we make this work with zero input from the developer?
If the information already exists somewhere (in .env, in package.json, in the spec),
Blobfish should find it itself.

## 2. Claude should never see a Blobfish error it can't fix

Every error message returned to Claude must include:
- What went wrong
- Exactly how to fix it (specific tool call or env var to set)

Generic errors like "auth failed" are not acceptable.
The user's AI shouldn't need to ask the user what to do next.

## 3. Security is not optional

All external URLs go through assertSafeUrl() — no exceptions.
All local file paths go through assertSafeLocalPath() — no exceptions.
Credentials are never logged (scrubUrl, sanitizeError).
New features that touch networking or the filesystem must follow the existing security patterns.

## 4. The registry is the distribution engine

Every registry entry is a user acquisition channel.
A well-documented registry entry for a popular API is worth more than a new feature.
Registry entries should have real notes — where to get the key, what the gotchas are.

## 5. Keep the install small

No TypeScript compilation. No build step. No heavy dependencies.
Current deps: @modelcontextprotocol/sdk, @apidevtools/swagger-parser, dotenv.
New dependencies need a strong justification. Most things can be done with Node.js stdlib.

## 6. Meta-tools must stay stable

The 17 meta-tool names are a public API. Clients build workflows around them.
Never rename or remove a meta-tool without a major version bump.
Adding new meta-tools is fine. Breaking existing ones is not.

## 7. Fail loudly at startup, silently in use

If blobfish.json has a malformed entry → log the error clearly and skip it.
If an API fails to load → tell Claude, don't crash the server.
If a tool call fails → return isError: true with a helpful message, don't throw.
The server should never crash due to a bad spec or a failed API call.
