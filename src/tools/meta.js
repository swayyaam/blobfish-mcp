export const AUTH_SCHEMA = {
  type: 'object',
  description: 'Auth config for this API',
  properties: {
    type: { type: 'string', enum: ['bearer', 'apikey', 'basic', 'oauth2', 'none'] },
    key: { type: 'string' }, header: { type: 'string' },
    username: { type: 'string' }, password: { type: 'string' },
    token_url: { type: 'string', description: 'oauth2: token endpoint (client_credentials grant)' },
    client_id: { type: 'string', description: 'oauth2: client ID' },
    client_secret: { type: 'string', description: 'oauth2: client secret' },
    scope: { type: 'string', description: 'oauth2: space-separated scopes (optional)' },
    audience: { type: 'string', description: 'oauth2: audience parameter, required by some providers (optional)' },
    client_auth: { type: 'string', enum: ['body', 'basic'], description: 'oauth2: how to send client credentials — form body (default) or HTTP Basic header' },
  },
};

export const META_TOOLS = [
  {
    name: 'list_registry',
    description: 'List all pre-configured APIs in the registry. Use load_api with just the name (e.g. "github") to load one instantly.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'discover_api',
    description: 'Auto-find and load an API from just a domain — no spec URL needed.',
    inputSchema: {
      type: 'object',
      properties: {
        base_url: { type: 'string' }, name: { type: 'string' }, auth: AUTH_SCHEMA,
        mock: { type: 'boolean' }, timeout: { type: 'integer' },
        include_tags: { type: 'array', items: { type: 'string' }, description: 'Only load endpoints with these tags' },
        exclude_tags: { type: 'array', items: { type: 'string' }, description: 'Skip endpoints with these tags' },
        shallow: { type: 'boolean', description: 'Strip deeply nested schemas to reduce token usage' },
      },
      required: ['base_url'],
    },
  },
  {
    name: 'load_api',
    description: 'Load any OpenAPI/Swagger spec or Postman collection — by URL or local file path.',
    inputSchema: {
      type: 'object',
      properties: {
        spec_url: { type: 'string' }, name: { type: 'string' }, auth: AUTH_SCHEMA,
        mock: { type: 'boolean' }, timeout: { type: 'integer' }, retries: { type: 'integer' },
        include_tags: { type: 'array', items: { type: 'string' }, description: 'Only load endpoints with these tags' },
        exclude_tags: { type: 'array', items: { type: 'string' }, description: 'Skip endpoints with these tags' },
        shallow: { type: 'boolean', description: 'Strip deeply nested schemas to reduce token usage' },
      },
      required: ['spec_url'],
    },
  },
  {
    name: 'set_api_auth',
    description: '⚠️ Update auth for a loaded API at runtime. Warning: credentials here are visible in this conversation. For production keys use .env or blobfish.json instead.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'API name (from list_apis)' },
        auth: AUTH_SCHEMA,
      },
      required: ['name', 'auth'],
    },
  },
  {
    name: 'fetch_all',
    description: 'Fetch all pages of a paginated endpoint automatically. Handles Link headers, cursor, offset pagination.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, args: { type: 'object', default: {} }, max_pages: { type: 'integer', default: 10 } }, required: ['tool_name'] },
  },
  {
    name: 'save_workflow',
    description: 'Save a workflow by name so it can be re-run later with run_workflow(name: "..."). Persists for the lifetime of this session.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Unique name for this workflow' },
        steps: {
          type: 'array',
          description: 'Workflow steps (same format as run_workflow)',
          items: { type: 'object' },
        },
        description: { type: 'string', description: 'Optional description of what this workflow does' },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List all saved workflows and their step counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'run_workflow',
    description: 'Run a multi-step workflow. Reference previous results with {{ steps.id.data.field }}. Supports foreach and run_if per step. Pass name to run a saved workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of a saved workflow to run (from list_workflows). If provided, steps are optional.' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, tool: { type: 'string' },
              args: { type: 'object' }, on_error: { type: 'string', enum: ['stop', 'continue'], default: 'stop' },
              foreach: { description: 'Array or {{ expr }} — run step once per item, {{ item }} available in args' },
              run_if: { type: 'string', description: 'Skip step if false. E.g. "{{ steps.check.status }} == 404"' },
            },
            required: ['tool'],
          },
        },
        input: { type: 'object' },
      },
      required: ['steps'],
    },
  },
  {
    name: 'get_last_request_log',
    description: 'Show the last N HTTP requests Blobfish made. Use when a call returns 400/422 — see the exact URL and body sent to self-correct.',
    inputSchema: { type: 'object', properties: { n: { type: 'integer', description: 'Number of recent requests to return (default: 1, max: 20)', default: 1 } } },
  },
  {
    name: 'rate_limit_status',
    description: 'Show current rate limit state for all loaded APIs — which are blocked and when they reset.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cache_stats',
    description: 'Show response cache statistics — hit rate, size, and cached entries.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'clear_cache',
    description: "Clear the response cache. Optionally clear only one API's cached entries.",
    inputSchema: { type: 'object', properties: { api_name: { type: 'string' } } },
  },
  {
    name: 'test_connection',
    description: 'Test if a loaded API is reachable. Returns status code and response time.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'inspect_tool',
    description: 'Show the full schema of any loaded tool — description and all input parameters.',
    inputSchema: { type: 'object', properties: { tool_name: { type: 'string' } }, required: ['tool_name'] },
  },
  {
    name: 'api_summary',
    description: 'Plain-English overview of a loaded API — purpose, capability groups, endpoint count.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'list_apis',
    description: 'List all currently loaded APIs and how many tools each provides.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'unload_api',
    description: 'Remove a loaded API and all its tools.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

// SEC-7: Reserved names dynamic tools cannot shadow
export const META_TOOL_NAMES = new Set(META_TOOLS.map(t => t.name));
