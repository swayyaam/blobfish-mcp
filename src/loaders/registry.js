import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../constants.js';

const REGISTRY_DIR = path.join(ROOT_DIR, 'registry');

export function getRegistryEntry(name) {
  const file = path.join(REGISTRY_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

export function listRegistryEntries() {
  if (!fs.existsSync(REGISTRY_DIR)) return [];
  return fs.readdirSync(REGISTRY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const e = JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), 'utf8'));
        return {
          name: f.replace('.json', ''),
          title: e.title || e.name || f.replace('.json', ''),
          description: e.description || '',
          auth_required: !!(e.auth && e.auth.type !== 'none'),
          include_tags: e.include_tags || [],
          notes: e.notes || '',
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

// #3: After interpolating registry auth, check if any ${VAR} remain unresolved.
// Throws a Claude-readable error with exact instructions on how to fix it.
export function checkUnresolvedAuth(auth, apiName) {
  if (!auth) return;
  for (const val of Object.values(auth)) {
    if (typeof val !== 'string') continue;
    const match = val.match(/\$\{([^}]+)\}/);
    if (match) {
      const varName = match[1];
      const example = auth.type === 'oauth2'
        ? `set_api_auth("${apiName}", { "type": "oauth2", "token_url": "...", "client_id": "...", "client_secret": "..." })`
        : `set_api_auth("${apiName}", { "type": "${auth.type || 'bearer'}", "key": "<their key>" })`;
      throw new Error(
        `"${apiName}" requires the ${varName} environment variable which is not set.\n\n` +
        `To fix this: ask the user to provide their credentials, then call:\n` +
        example
      );
    }
  }
}

// Returns true if str looks like a registry name (not a URL or file path)
export function isRegistryName(str) {
  return !str.includes('://') && !str.includes('/') && !str.includes('\\') &&
         !str.endsWith('.json') && !str.endsWith('.yaml') && !str.endsWith('.yml');
}
