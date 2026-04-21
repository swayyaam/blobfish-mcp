#!/usr/bin/env node
import './src/constants.js'; // ensures dotenv runs before anything else

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';

import { META_TOOLS } from './src/tools/meta.js';
import { handleToolCall } from './src/tools/handlers.js';
import { getAllTools } from './src/registry.js';
import { loadedApis, savedWorkflows } from './src/state.js';
import { autoLoad } from './src/loaders/auto.js';
import { loadSpec } from './src/loaders/openapi.js';
import { interpolateObj, slugify } from './src/utils.js';
import { ROOT_DIR } from './src/constants.js';

const server = new Server({ name: 'blobfish', version: '8.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...META_TOOLS, ...getAllTools()],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  return handleToolCall(req, {
    notifyToolsChanged: () => server.sendToolListChanged(),
  });
});

// ── Startup ───────────────────────────────────────────────────────────────────

const blobfishConfigPath = path.join(ROOT_DIR, 'blobfish.json');

async function loadBlobfishConfig(onlyNew = false) {
  if (!fs.existsSync(blobfishConfigPath)) return;
  try {
    const cfg = JSON.parse(fs.readFileSync(blobfishConfigPath, 'utf8'));
    if (!onlyNew) {
      for (const wf of Object.entries(cfg.workflows || {})) savedWorkflows.set(wf[0], wf[1]);
    }
    let changed = false;
    for (const entry of (cfg.apis || [])) {
      const expectedName = slugify(entry.name);
      if (onlyNew && loadedApis.has(expectedName)) continue; // #4: skip already-loaded
      await autoLoad(entry.url, entry.name, interpolateObj(entry.auth), entry.mock || false, entry.timeout ?? cfg.timeout, entry.retries ?? cfg.retries, entry.include_tags, entry.exclude_tags, entry.shallow);
      changed = true;
    }
    if (onlyNew && changed) {
      await server.sendToolListChanged();
      console.error(`[Blobfish] blobfish.json changed — new APIs loaded`);
    }
  } catch (e) {
    console.error(`[Blobfish] Error reading blobfish.json: ${e.message}`);
  }
}

await loadBlobfishConfig();

// #4: Hot-reload — watch blobfish.json for new entries
if (fs.existsSync(blobfishConfigPath)) {
  let debounce;
  fs.watch(blobfishConfigPath, () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => loadBlobfishConfig(true), 300);
  });
}

for (const url of process.argv.slice(2)) await loadSpec(url);

const { LOG_PATH } = await import('./src/constants.js');
console.error(`[Blobfish] Ready — ${META_TOOLS.length} meta-tools${loadedApis.size ? `, ${getAllTools().length} API tools` : ''}${LOG_PATH ? ` | log → ${LOG_PATH}` : ''}`);

const transport = new StdioServerTransport();
await server.connect(transport);
