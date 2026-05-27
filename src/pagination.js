// Well-known field names that commonly hold the data array, in priority order.
// Checked before falling back to "first array found" to avoid returning error/metadata arrays.
const DATA_ARRAY_PRIORITY = [
  'data', 'items', 'results', 'records', 'rows',
  'content', 'list', 'entries', 'objects', 'hits',
  'members', 'values', 'payload', 'documents',
];

export function findDataArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  // 1. Check priority field names first
  for (const key of DATA_ARRAY_PRIORITY) {
    if (Array.isArray(data[key])) return data[key];
  }

  // 2. Check one level of common nesting (e.g. data.items, response.data)
  for (const key of ['data', 'response', 'body']) {
    const nested = data[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const nkey of DATA_ARRAY_PRIORITY) {
        if (Array.isArray(nested[nkey])) return nested[nkey];
      }
    }
  }

  // 3. Fall back to first non-empty array found (skip arrays with <= 0 items
  //    at known error/metadata fields to avoid false positives)
  const SKIP_FIELDS = new Set(['errors', 'warnings', 'messages', 'meta', 'links', 'included']);
  for (const [key, val] of Object.entries(data)) {
    if (!SKIP_FIELDS.has(key) && Array.isArray(val) && val.length > 0) return val;
  }

  // 4. Last resort — any array including empty ones
  for (const val of Object.values(data)) {
    if (Array.isArray(val)) return val;
  }

  return null;
}

export function detectNextPage(data, headers, currentArgs) {
  const link = headers?.link || headers?.Link || '';
  const linkMatch = link.match(/<([^>]+)>;\s*rel="next"/);
  if (linkMatch) return { type: 'url', url: linkMatch[1] };
  if (!data || typeof data !== 'object') return null;
  const meta = data.meta || data.pagination || data.paging || data;
  for (const field of ['next', 'next_url', 'next_cursor', 'cursor', 'next_page_token', 'after', 'continuation_token']) {
    const val = meta[field]; if (val && typeof val === 'string') return { type: 'cursor', field, value: val };
  }
  if (data.has_more === true) { const limit = currentArgs.limit ?? currentArgs.per_page ?? 20; return { type: 'offset', offset: (currentArgs.offset ?? 0) + limit, limit }; }
  if (typeof data.total === 'number' && typeof data.offset === 'number' && typeof data.limit === 'number') {
    const next = data.offset + data.limit; if (next < data.total) return { type: 'offset', offset: next, limit: data.limit };
  }
  return null;
}
