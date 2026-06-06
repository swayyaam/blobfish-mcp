#!/usr/bin/env node
import './src/constants.js';

// --setup flag: configure Claude Desktop without cloning the repo
// Usage: npx blobfish-mcp --setup
if (process.argv.includes('--setup')) {
  const { default: setup } = await import('./setup.js');
  process.exit(0);
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';

// HTTP/SSE transport (optional — loaded only when --http or --sse flag is passed)
const useHttp = process.argv.includes('--http');
const useSse  = process.argv.includes('--sse');
const httpPort = parseInt(process.env.BLOBFISH_PORT ?? '3000');

import { META_TOOLS } from './src/tools/meta.js';
import { handleToolCall } from './src/tools/handlers.js';
import { getAllTools } from './src/registry.js';
import { loadedApis, savedWorkflows } from './src/state.js';
import { autoLoad } from './src/loaders/auto.js';
import { autoEnvLoad } from './src/loaders/env.js';
import { loadSpec } from './src/loaders/openapi.js';
import { interpolateObj, slugify } from './src/utils.js';
import { ROOT_DIR, AUTO_LOAD } from './src/constants.js';

const server = new Server({ name: 'blobfish', version: '1.2.0' }, { capabilities: { tools: {} } });

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
      for (const [wfName, wfDef] of Object.entries(cfg.workflows || {})) {
        // Support both {steps:[...]} object and bare array
        const steps = Array.isArray(wfDef) ? wfDef : wfDef.steps;
        if (steps) savedWorkflows.set(wfName, { steps, description: wfDef.description || '' });
      }
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

// Auto-load from .env: silently load registry APIs whose env vars are present.
// On by default — disable with BLOBFISH_AUTO_LOAD=false.
if (AUTO_LOAD) {
  const n = await autoEnvLoad();
  if (n > 0) await server.sendToolListChanged();
}

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

if (useHttp) {
  // Streamable HTTP transport — MCP spec 2025-03-26+
  const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const { createServer } = await import('http');
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  const httpServer = createServer(async (req, res) => {
    try { await transport.handleRequest(req, res); }
    catch (e) { res.writeHead(500); res.end(e.message); }
  });
  httpServer.listen(httpPort, () =>
    console.error(`[Blobfish] HTTP transport listening on http://localhost:${httpPort}/mcp`)
  );
} else if (useSse) {
  // SSE transport — compatible with older MCP clients
  const { SSEServerTransport } = await import('@modelcontextprotocol/sdk/server/sse.js');
  const { createServer } = await import('http');
  const transport = new SSEServerTransport('/message', null);
  const httpServer = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
    try { await transport.handleRequest(req, res); }
    catch (e) { res.writeHead(500); res.end(e.message); }
  });
  httpServer.listen(httpPort, async () => {
    await server.connect(transport);
    console.error(`[Blobfish] SSE transport listening on http://localhost:${httpPort}/sse`);
  });
} else {
  // Default: stdio (Claude Desktop, Cursor, etc.)
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
