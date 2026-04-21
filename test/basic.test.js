import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Unit tests for pure utility functions ─────────────────────────────────────
// These don't spin up the MCP server — they test logic in isolation.

// We inline the functions under test to avoid importing server.js
// (which connects to stdio and blocks). Extract to lib/ if this grows.

function sanitizeDesc(str, maxLen = 300) {
  if (typeof str !== 'string') return str;
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLen);
}

function scrubUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const CRED_PARAMS = new Set(['api_key', 'apikey', 'access_token', 'token', 'key', 'secret', 'password']);
    for (const k of u.searchParams.keys()) {
      if (CRED_PARAMS.has(k.toLowerCase())) u.searchParams.set(k, '[REDACTED]');
    }
    return u.toString();
  } catch { return urlStr; }
}

function getCacheKey(toolName, args) {
  try {
    const stable = JSON.stringify(args, Object.keys(args || {}).sort());
    return `${toolName}:${stable}`;
  } catch { return `${toolName}:nocache`; }
}

function evaluateCondition(expr) {
  const s = String(expr).trim();
  const eq = s.match(/^(.+?)\s*==\s*(.+)$/);
  if (eq) return String(eq[1].trim()) === String(eq[2].trim());
  const ne = s.match(/^(.+?)\s*!=\s*(.+)$/);
  if (ne) return String(ne[1].trim()) !== String(ne[2].trim());
  return s !== '' && s !== 'false' && s !== '0' && s !== 'null' && s !== 'undefined';
}

function sanitizeError(err) {
  let msg = err?.message || String(err);
  msg = msg.replace(/[A-Za-z]:\\[^\s,;]*/g, '[path]');
  msg = msg.replace(/\/[^\s,;]{3,}/g, '[path]');
  return msg;
}

function slugify(str) {
  return (str || 'api').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'api';
}

// ── sanitizeDesc ──────────────────────────────────────────────────────────────

test('sanitizeDesc truncates long descriptions', () => {
  const long = 'a'.repeat(500);
  assert.equal(sanitizeDesc(long).length, 300);
});

test('sanitizeDesc strips control characters', () => {
  assert.equal(sanitizeDesc('hello\x00world'), 'helloworld');
  assert.equal(sanitizeDesc('test\x07bell'), 'testbell');
});

test('sanitizeDesc passes through normal strings', () => {
  assert.equal(sanitizeDesc('Get user by ID'), 'Get user by ID');
});

test('sanitizeDesc handles non-string input', () => {
  assert.equal(sanitizeDesc(null), null);
  assert.equal(sanitizeDesc(42), 42);
});

// ── scrubUrl ──────────────────────────────────────────────────────────────────

test('scrubUrl redacts api_key param', () => {
  const url = 'https://api.example.com/data?api_key=sk-secret123&limit=10';
  const scrubbed = decodeURIComponent(scrubUrl(url));
  assert.ok(scrubbed.includes('[REDACTED]'));
  assert.ok(!scrubbed.includes('sk-secret123'));
  assert.ok(scrubbed.includes('limit=10'));
});

test('scrubUrl redacts access_token param', () => {
  const url = 'https://api.example.com/me?access_token=tok_abc&format=json';
  const scrubbed = scrubUrl(url);
  assert.ok(!scrubbed.includes('tok_abc'));
});

test('scrubUrl leaves non-credential params untouched', () => {
  const url = 'https://api.example.com/search?q=cats&page=2';
  assert.equal(scrubUrl(url), url);
});

test('scrubUrl handles invalid URLs gracefully', () => {
  assert.equal(scrubUrl('not-a-url'), 'not-a-url');
});

// ── getCacheKey ───────────────────────────────────────────────────────────────

test('getCacheKey produces stable key regardless of arg order', () => {
  const k1 = getCacheKey('my_tool', { b: 2, a: 1 });
  const k2 = getCacheKey('my_tool', { a: 1, b: 2 });
  assert.equal(k1, k2);
});

test('getCacheKey handles circular references without throwing', () => {
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => getCacheKey('tool', circular));
  assert.ok(getCacheKey('tool', circular).includes('nocache'));
});

// ── evaluateCondition ─────────────────────────────────────────────────────────

test('evaluateCondition: equality match', () => {
  assert.equal(evaluateCondition('404 == 404'), true);
  assert.equal(evaluateCondition('200 == 404'), false);
});

test('evaluateCondition: inequality match', () => {
  assert.equal(evaluateCondition('200 != 404'), true);
  assert.equal(evaluateCondition('404 != 404'), false);
});

test('evaluateCondition: truthy/falsy strings', () => {
  assert.equal(evaluateCondition('true'), true);
  assert.equal(evaluateCondition('false'), false);
  assert.equal(evaluateCondition(''), false);
  assert.equal(evaluateCondition('0'), false);
  assert.equal(evaluateCondition('hello'), true);
});

// ── sanitizeError ─────────────────────────────────────────────────────────────

test('sanitizeError strips Windows paths', () => {
  const err = new Error('Cannot read C:\\Users\\swayam\\secret.json');
  assert.ok(!sanitizeError(err).includes('C:\\'));
  assert.ok(sanitizeError(err).includes('[path]'));
});

test('sanitizeError strips Unix paths', () => {
  const err = new Error('Failed to open /home/user/.env');
  assert.ok(!sanitizeError(err).includes('/home/user'));
  assert.ok(sanitizeError(err).includes('[path]'));
});

// ── slugify ───────────────────────────────────────────────────────────────────

test('slugify handles special characters', () => {
  assert.equal(slugify('Swagger Petstore'), 'swagger_petstore');
  assert.equal(slugify('My API v2!'), 'my_api_v2');
});

test('slugify truncates to 20 chars', () => {
  assert.ok(slugify('a'.repeat(50)).length <= 20);
});

test('slugify handles empty input', () => {
  assert.equal(slugify(''), 'api');
  assert.equal(slugify(null), 'api');
});
