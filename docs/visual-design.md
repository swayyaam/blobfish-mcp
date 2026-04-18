# Blobfish — Visual Design

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Claude Desktop                       │
│                                                         │
│  "Load the GitHub API"   →   calls load_api(url)        │
│  "List my repos"         →   calls github_get_repos()   │
└────────────────────┬────────────────────────────────────┘
                     │  MCP Protocol (stdio)
                     ▼
┌─────────────────────────────────────────────────────────┐
│                      Blobfish                            │
│                                                         │
│  ┌─────────────┐   ┌─────────────┐   ┌──────────────┐  │
│  │  load_api   │   │  list_apis  │   │  unload_api  │  │
│  └──────┬──────┘   └─────────────┘   └──────────────┘  │
│         │                                               │
│         ▼                                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │              swagger-parser                       │  │
│  │  fetches spec → dereferences $refs → builds tools │  │
│  └──────────────────────┬───────────────────────────┘  │
│                         │                               │
│         sendToolListChanged() ──→ Claude re-fetches     │
│                         │                               │
│  ┌──────────────────────▼───────────────────────────┐  │
│  │              Dynamic Tool Pool                    │  │
│  │  petstore_get_pets  │  github_get_repos  │  ...   │  │
│  └──────────────────────┬───────────────────────────┘  │
└─────────────────────────┼───────────────────────────────┘
                          │  HTTP (native fetch)
                          ▼
               ┌──────────────────────┐
               │    Any REST API      │
               │  PetStore / GitHub / │
               │  Stripe / your own   │
               └──────────────────────┘
```

---

## Claude's View — Before and After

**At startup (3 tools):**
```
load_api      — Load any OpenAPI spec by URL
list_apis     — Show loaded APIs and tool counts
unload_api    — Remove an API and its tools
```

**After `load_api("https://petstore.swagger.io/v2/swagger.json")`:**
```
load_api
list_apis
unload_api
petstore_get_pets
petstore_post_pets
petstore_get_pets_petId
petstore_post_pets_petId
petstore_delete_pets_petId
... (20 tools total)
```

**After loading a second API:**
```
load_api
list_apis
unload_api
petstore_get_pets
petstore_...
weather_get_forecast
weather_get_historical
... (both APIs live simultaneously)
```

---

## Tool Naming Convention

```
{api_name}_{http_method}_{path_slug}

petstore   _  get  _  pets_petId
   │           │          │
   │           │          └── path: /pets/{petId}, braces stripped
   │           └──────────── HTTP method
   └──────────────────────── slugified spec title
```

Rules:
- API name: slugified `info.title` from spec, max 20 chars (e.g. `swagger_petstore`)
- Path: leading `/` removed, `{param}` braces stripped, non-alphanumeric → `_`
- Collisions impossible across APIs because of the prefix

---

## Input Schema Design

Each tool's input schema is derived directly from the OpenAPI operation:

```
OpenAPI parameter (in: path)   →  required field in schema
OpenAPI parameter (in: query)  →  optional field in schema
OpenAPI parameter (in: header) →  optional field in schema
OpenAPI requestBody            →  optional/required "body" field
```

Example — `GET /pets/{petId}`:
```json
{
  "type": "object",
  "properties": {
    "petId": { "type": "integer", "description": "Pet id to delete" }
  },
  "required": ["petId"]
}
```

---

## Data Flow for a Tool Call

```
Claude calls petstore_get_pets_petId({ petId: 42 })
         │
         ▼
findHandler("petstore_get_pets_petId")
         │
         ▼
executeRequest(baseUrl, "get", "/pets/{petId}", operation, { petId: 42 })
         │
         ├── substitute path params:  /pets/42
         ├── add query params to URL
         ├── inject Authorization header (API_KEY env)
         ├── serialize body if present
         │
         ▼
fetch("https://petstore.swagger.io/v2/pets/42", { method: "GET", ... })
         │
         ▼
{ status: 200, ok: true, data: { id: 42, name: "doggie", ... } }
         │
         ▼
returned to Claude as JSON text
```
