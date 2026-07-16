import fs from 'fs';
import path from 'path';

// Environment profiles (1.3.0): --profile staging (or BLOBFISH_PROFILE=staging)
// 1. loads blobfish.staging.json if it exists (falls back to blobfish.json)
// 2. selects auth_profiles.staging over auth on each API entry

// Profile names become part of a filename — keep them strictly alphanumeric to block traversal
export function assertValidProfile(profile) {
  if (!/^[a-zA-Z0-9_-]+$/.test(profile))
    throw new Error(`Invalid profile name "${profile}" — use letters, digits, - and _ only.`);
  return profile;
}

export function resolveConfigPath(rootDir, profile, existsFn = fs.existsSync) {
  const defaultPath = path.join(rootDir, 'blobfish.json');
  if (!profile) return defaultPath;
  assertValidProfile(profile);
  const profilePath = path.join(rootDir, `blobfish.${profile}.json`);
  return existsFn(profilePath) ? profilePath : defaultPath;
}

// Per-API auth profiles: { "auth_profiles": { "staging": {...}, "production": {...} }, "auth": {...} }
// The active profile's entry wins; "auth" is the fallback for unlisted profiles and no-profile runs.
export function selectAuth(entry, profile) {
  if (profile && entry.auth_profiles?.[profile]) return entry.auth_profiles[profile];
  return entry.auth;
}

// CLI args: flags must not be swallowed by the positional spec-URL loop
const VALUE_FLAGS = new Set(['--profile']);

export function parseArgs(argv) {
  const flags = {}, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (VALUE_FLAGS.has(arg)) { flags[arg.slice(2)] = argv[++i]; continue; }
    if (arg.startsWith('--')) { flags[arg.slice(2)] = true; continue; }
    positional.push(arg);
  }
  return { flags, positional };
}
