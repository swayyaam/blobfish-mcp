export function resolveValue(val, context) {
  if (typeof val !== 'string') return val;
  return val.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, expr) => {
    let cur = context;
    for (const part of expr.trim().split('.')) { if (cur == null) return ''; cur = cur[part]; }
    return cur != null ? String(cur) : '';
  });
}

export function resolveArgs(val, context) {
  if (typeof val === 'string') return resolveValue(val, context);
  if (Array.isArray(val)) return val.map(v => resolveArgs(v, context));
  if (val && typeof val === 'object') { const out = {}; for (const [k, v] of Object.entries(val)) out[k] = resolveArgs(v, context); return out; }
  return val;
}

// Simple condition evaluator for run_if: "404 == 404", "true != false"
export function evaluateCondition(expr) {
  const s = String(expr).trim();
  const eq = s.match(/^(.+?)\s*==\s*(.+)$/);
  if (eq) return String(eq[1].trim()) === String(eq[2].trim());
  const ne = s.match(/^(.+?)\s*!=\s*(.+)$/);
  if (ne) return String(ne[1].trim()) !== String(ne[2].trim());
  return s !== '' && s !== 'false' && s !== '0' && s !== 'null' && s !== 'undefined';
}
