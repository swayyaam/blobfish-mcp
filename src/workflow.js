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

// Simple condition evaluator for run_if: "404 == 200", "count >= 10", "true != false"
export function evaluateCondition(expr) {
  const s = String(expr).trim();

  // Order matters: check multi-char operators before single-char ones
  for (const [pat, fn] of [
    [/^(.+?)\s*>=\s*(.+)$/, (a, b) => Number(a) >= Number(b)],
    [/^(.+?)\s*<=\s*(.+)$/, (a, b) => Number(a) <= Number(b)],
    [/^(.+?)\s*!=\s*(.+)$/, (a, b) => String(a) !== String(b)],
    [/^(.+?)\s*==\s*(.+)$/, (a, b) => String(a) === String(b)],
    [/^(.+?)\s*>\s*(.+)$/,  (a, b) => Number(a) >  Number(b)],
    [/^(.+?)\s*<\s*(.+)$/,  (a, b) => Number(a) <  Number(b)],
  ]) {
    const m = s.match(pat);
    if (m) return fn(m[1].trim(), m[2].trim());
  }

  return s !== '' && s !== 'false' && s !== '0' && s !== 'null' && s !== 'undefined';
}
