// Central shared state — imported by any module that needs to read/write it.
// Use object references so mutations propagate across module boundaries.

export const loadedApis     = new Map(); // apiName → api entry
export const toolMeta       = new Map(); // toolName → { method, apiName }
export const responseCache  = new Map(); // cacheKey → { data, expiresAt }
export const rateLimitState = new Map(); // apiName → { blockedUntil }
export const savedWorkflows = new Map(); // name → workflow steps

export const cacheStats = { hits: 0, misses: 0 };
export const requestLog = []; // ring buffer, max MAX_LOG_ENTRIES
