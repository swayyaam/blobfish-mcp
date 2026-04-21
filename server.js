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
import { interpolateObj } from './src/utils.js';
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
if (fs.existsSync(blobfishConfigPath)) {
  const cfg = JSON.parse(fs.readFileSync(blobfishConfigPath, 'utf8'));
  for (const wf of Object.entries(cfg.workflows || {})) savedWorkflows.set(wf[0], wf[1]);
  for (const entry of (cfg.apis || [])) {
    await autoLoad(entry.url, entry.name, interpolateObj(entry.auth), entry.mock || false, entry.timeout ?? cfg.timeout, entry.retries ?? cfg.retries, entry.include_tags, entry.exclude_tags, entry.shallow);
  }
}

for (const url of process.argv.slice(2)) await loadSpec(url);

const { LOG_PATH } = await import('./src/constants.js');
console.error(`[Blobfish] Ready — ${META_TOOLS.length} meta-tools${loadedApis.size ? `, ${getAllTools().length} API tools` : ''}${LOG_PATH ? ` | log → ${LOG_PATH}` : ''}`);

const transport = new StdioServerTransport();
await server.connect(transport);
