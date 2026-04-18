#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodePath = process.execPath.replace(/\\/g, '/');
const serverPath = path.join(__dirname, 'server.js').replace(/\\/g, '/');

function findClaudeConfig() {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const packagesDir = path.join(localAppData, 'Packages');
    if (fs.existsSync(packagesDir)) {
      const claudePkg = fs.readdirSync(packagesDir).find(d => d.startsWith('Claude_'));
      if (claudePkg) {
        return path.join(packagesDir, claudePkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
      }
    }
  }
  return path.join(process.env.APPDATA, 'Claude', 'claude_desktop_config.json');
}

const configPath = findClaudeConfig();
const existing = fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
  : {};

existing.mcpServers = existing.mcpServers || {};
existing.mcpServers.blobfish = {
  command: nodePath,
  args: [serverPath],
  env: { API_KEY: '' },
};

fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));

console.log(`✓ Blobfish configured at:\n  ${configPath}`);
console.log(`✓ Node: ${nodePath}`);
console.log(`✓ Server: ${serverPath}`);
console.log(`\nReload MCP config in Claude Desktop (Help menu → Reload MCP Configuration) to connect.`);
