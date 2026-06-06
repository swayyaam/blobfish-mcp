import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../constants.js';
import { loadedApis } from '../state.js';
import { autoLoad } from './auto.js';
import { interpolateObj } from '../utils.js';

const REGISTRY_DIR = path.join(ROOT_DIR, 'registry');

// Extract all ${VAR} references from an auth object
function extractEnvRefs(auth) {
  if (!auth || typeof auth !== 'object') return [];
  const refs = [];
  for (const val of Object.values(auth)) {
    if (typeof val !== 'string') continue;
    for (const m of val.matchAll(/\$\{([^}]+)\}/g)) refs.push(m[1]);
  }
  return refs;
}

// Load registry entries whose auth env vars are all present in process.env.
// Skips entries already loaded (e.g. via blobfish.json).
// Returns the number of APIs auto-loaded.
// { loader, registryDir } are injectable for testing; defaults are the real implementations.
export async function autoEnvLoad({ loader = autoLoad, registryDir = REGISTRY_DIR } = {}) {
  if (!fs.existsSync(registryDir)) return 0;
  const files = fs.readdirSync(registryDir).filter(f => f.endsWith('.json'));
  let loaded = 0;

  for (const file of files) {
    let entry;
    try { entry = JSON.parse(fs.readFileSync(path.join(registryDir, file), 'utf8')); }
    catch { continue; }

    const auth = entry.auth;
    if (!auth) continue; // public API, not keyed — skip auto-load

    const refs = extractEnvRefs(auth);
    if (!refs.length) continue; // no env var references, nothing to detect

    const allPresent = refs.every(v => !!process.env[v]);
    if (!allPresent) continue;

    // Don't reload if already loaded from blobfish.json
    const expectedName = (entry.name || file.replace('.json', '')).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'api';
    if (loadedApis.has(expectedName)) continue;

    try {
      await loader(
        entry.spec_url,
        entry.name,
        interpolateObj(auth),
        false,
        undefined,
        undefined,
        entry.include_tags || null,
        entry.exclude_tags || null,
        entry.shallow || false,
      );
      loaded++;
    } catch (e) {
      // Log but don't crash — Principle 7: fail loudly at startup but let the server continue
      console.error(`[Blobfish] Auto-load failed for "${entry.name}": ${e.message}`);
    }
  }

  return loaded;
}
