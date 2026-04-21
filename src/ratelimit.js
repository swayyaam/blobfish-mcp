import { rateLimitState } from './state.js';
import { sleep } from './utils.js';

export function updateRateLimit(apiName, headers) {
  const remaining = parseInt(headers['x-ratelimit-remaining'] ?? headers['ratelimit-remaining'] ?? headers['x-rate-limit-remaining'] ?? '999');
  const reset = parseInt(headers['x-ratelimit-reset'] ?? headers['ratelimit-reset'] ?? headers['x-rate-limit-reset'] ?? '0');
  if (remaining <= 1 && reset > 0) {
    const blockedUntil = reset > 1_000_000_000 ? reset * 1000 : Date.now() + reset * 1000;
    rateLimitState.set(apiName, { blockedUntil });
    console.error(`[Blobfish] "${apiName}" rate limit hit — waiting until ${new Date(blockedUntil).toISOString()}`);
  }
}

export async function waitIfRateLimited(apiName) {
  const state = rateLimitState.get(apiName);
  if (!state) return;
  const waitMs = state.blockedUntil - Date.now();
  if (waitMs > 0) {
    console.error(`[Blobfish] Pausing ${Math.ceil(waitMs / 1000)}s for "${apiName}" rate limit...`);
    await sleep(waitMs);
  }
  rateLimitState.delete(apiName);
}
