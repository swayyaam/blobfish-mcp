export function findDataArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;
  for (const val of Object.values(data)) { if (Array.isArray(val) && val.length > 0) return val; }
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
