import { loadedApis, toolMeta } from './state.js';
import { META_TOOL_NAMES } from './tools/meta.js';

export function getAllTools() {
  return [...loadedApis.values()].flatMap(a => a.tools);
}

export function findHandler(name) {
  for (const { handlers } of loadedApis.values()) {
    if (handlers.has(name)) return handlers.get(name);
  }
  return null;
}

export function findTool(name) {
  for (const { tools } of loadedApis.values()) {
    const t = tools.find(t => t.name === name);
    if (t) return t;
  }
  return null;
}

// SEC-7: Ensure dynamic tool names never shadow meta-tools
export function makeUniqueName(candidate) {
  if (!META_TOOL_NAMES.has(candidate) && !findTool(candidate)) return candidate;
  let i = 1;
  while (META_TOOL_NAMES.has(`${candidate}_${i}`) || findTool(`${candidate}_${i}`)) i++;
  return `${candidate}_${i}`;
}
