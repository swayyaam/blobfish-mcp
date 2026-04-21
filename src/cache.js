import { responseCache, cacheStats } from './state.js';

export function getCacheKey(toolName, args) {
  try {
    const stable = JSON.stringify(args, Object.keys(args || {}).sort());
    return `${toolName}:${stable}`;
  } catch { return `${toolName}:nocache`; }
}

export function getCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { responseCache.delete(key); return null; }
  return entry.data;
}

export function setCached(key, data, ttlSeconds) {
  responseCache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function recordHit()  { cacheStats.hits++; }
export function recordMiss() { cacheStats.misses++; }
