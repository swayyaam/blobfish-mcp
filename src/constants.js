import { config } from 'dotenv';
config(); // must run before any process.env reads

import path from 'path';
import { fileURLToPath } from 'url';

export const ROOT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const DEFAULT_TIMEOUT    = parseInt(process.env.BLOBFISH_TIMEOUT   ?? '30000');
export const DEFAULT_RETRIES    = parseInt(process.env.BLOBFISH_RETRIES   ?? '3');
export const DEFAULT_CACHE_TTL  = parseInt(process.env.BLOBFISH_CACHE_TTL ?? '60');
export const ALLOW_LOCAL        = process.env.BLOBFISH_ALLOW_LOCAL === 'true';
export const MAX_SPEC_SIZE      = 10 * 1024 * 1024;
export const MAX_RESP_SIZE      =  5 * 1024 * 1024;
export const MAX_TOOLS_PER_SPEC = 500;
export const MAX_LOG_ENTRIES    = 20;
export const LOG_PATH = process.env.BLOBFISH_LOG
  ? (process.env.BLOBFISH_LOG === 'true'
      ? path.join(ROOT_DIR, 'blobfish.log')
      : process.env.BLOBFISH_LOG)
  : null;

export const SPEC_PROBE_PATHS = [
  '/openapi.json', '/openapi.yaml', '/swagger.json', '/swagger.yaml',
  '/api/openapi.json', '/api/swagger.json', '/api-docs', '/api-docs/swagger.json',
  '/v1/openapi.json', '/v2/openapi.json', '/v3/openapi.json',
  '/api/v1/openapi.json', '/api/v2/openapi.json', '/public/openapi.json', '/docs/openapi.json',
];

export const PRIVATE_IP_RE = [
  /^127\./, /^0\.0\.0\.0/, /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./,
  /^::1$/, /^fc00:/i, /^fe80:/i,
];

export const CRED_PARAMS = new Set([
  'api_key', 'apikey', 'access_token', 'token', 'key', 'secret',
  'password', 'client_secret', 'auth', 'authorization', 'bearer', 'private_key',
]);
