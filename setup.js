#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodePath = process.execPath.replace(/\\/g, '/');
const serverPath = path.join(__dirname, 'server.js').replace(/\\/g, '/');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function findClaudeConfig() {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const packagesDir = path.join(localAppData, 'Packages');
    if (fs.existsSync(packagesDir)) {
      const claudePkg = fs.readdirSync(packagesDir).find(d => d.startsWith('Claude_'));
      if (claudePkg) return path.join(packagesDir, claudePkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
    }
  }
  // macOS fallback
  const home = process.env.HOME;
  if (home) {
    const macPath = path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    if (fs.existsSync(path.dirname(macPath))) return macPath;
  }
  return path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
}

console.log('\n🐟 Blobfish Setup\n');

// Step 1: Claude Desktop config
const configPath = findClaudeConfig();
const answer = await ask(`Install Blobfish into Claude Desktop? (Y/n) `);

if (answer.toLowerCase() !== 'n') {
  const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  existing.mcpServers = existing.mcpServers || {};
  existing.mcpServers.blobfish = { command: nodePath, args: [serverPath], env: { API_KEY: '' } };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
  console.log(`✓ Claude Desktop configured at:\n  ${configPath}`);
} else {
  console.log('  Skipped Claude Desktop config.');
}

// Step 2: Create .env if missing
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  const examplePath = path.join(__dirname, '.env.example');
  if (fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, envPath);
    console.log('✓ Created .env from .env.example');
  } else {
    fs.writeFileSync(envPath, '# Blobfish environment variables\nAPI_KEY=\n');
    console.log('✓ Created .env');
  }
} else {
  console.log('  .env already exists — skipped.');
}

// Step 3: Create blobfish.json if missing
const blobfishPath = path.join(process.cwd(), 'blobfish.json');
if (!fs.existsSync(blobfishPath)) {
  fs.writeFileSync(blobfishPath, JSON.stringify({ apis: [] }, null, 2) + '\n');
  console.log('✓ Created blobfish.json');
} else {
  console.log('  blobfish.json already exists — skipped.');
}

console.log('\nDone! Reload MCP config in Claude Desktop: Help → Reload MCP Configuration\n');
