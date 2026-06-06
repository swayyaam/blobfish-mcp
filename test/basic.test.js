import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import from actual modules — safe since none of src/ connects to stdio
import { sanitizeDesc, scrubUrl, sanitizeError } from '../src/security.js';
import { slugify } from '../src/utils.js';
import { getCacheKey } from '../src/cache.js';
import { evaluateCondition } from '../src/workflow.js';
import { isRegistryName, checkUnresolvedAuth } from '../src/loaders/registry.js';

// ── sanitizeDesc ──────────────────────────────────────────────────────────────

test('sanitizeDesc truncates long descriptions', () => {
  assert.equal(sanitizeDesc('a'.repeat(500)).length, 300);
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
  const scrubbed = decodeURIComponent(scrubUrl('https://api.example.com/data?api_key=sk-secret&limit=10'));
  assert.ok(scrubbed.includes('[REDACTED]'));
  assert.ok(!scrubbed.includes('sk-secret'));
  assert.ok(scrubbed.includes('limit=10'));
});

test('scrubUrl redacts access_token param', () => {
  assert.ok(!decodeURIComponent(scrubUrl('https://api.example.com/me?access_token=tok_abc')).includes('tok_abc'));
});

test('scrubUrl leaves non-credential params untouched', () => {
  const url = 'https://api.example.com/search?q=cats&page=2';
  assert.equal(scrubUrl(url), url);
});

test('scrubUrl handles invalid URLs gracefully', () => {
  assert.equal(scrubUrl('not-a-url'), 'not-a-url');
});

// ── sanitizeError ─────────────────────────────────────────────────────────────

test('sanitizeError strips Windows paths', () => {
  const msg = sanitizeError(new Error('Cannot read C:\\Users\\swayam\\secret.json'));
  assert.ok(!msg.includes('C:\\'));
  assert.ok(msg.includes('[path]'));
});

test('sanitizeError strips Unix paths', () => {
  const msg = sanitizeError(new Error('Failed to open /home/user/.env'));
  assert.ok(!msg.includes('/home/user'));
  assert.ok(msg.includes('[path]'));
});

// ── getCacheKey ───────────────────────────────────────────────────────────────

test('getCacheKey produces stable key regardless of arg order', () => {
  assert.equal(getCacheKey('tool', { b: 2, a: 1 }), getCacheKey('tool', { a: 1, b: 2 }));
});

test('getCacheKey handles circular references without throwing', () => {
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => getCacheKey('tool', circular));
  assert.ok(getCacheKey('tool', circular).includes('nocache'));
});

// ── evaluateCondition ─────────────────────────────────────────────────────────

test('evaluateCondition: equality', () => {
  assert.equal(evaluateCondition('404 == 404'), true);
  assert.equal(evaluateCondition('200 == 404'), false);
});

test('evaluateCondition: inequality', () => {
  assert.equal(evaluateCondition('200 != 404'), true);
  assert.equal(evaluateCondition('404 != 404'), false);
});

test('evaluateCondition: numeric comparisons', () => {
  assert.equal(evaluateCondition('10 > 5'), true);
  assert.equal(evaluateCondition('5 > 10'), false);
  assert.equal(evaluateCondition('10 < 5'), false);
  assert.equal(evaluateCondition('5 < 10'), true);
  assert.equal(evaluateCondition('10 >= 10'), true);
  assert.equal(evaluateCondition('9 >= 10'), false);
  assert.equal(evaluateCondition('10 <= 10'), true);
  assert.equal(evaluateCondition('11 <= 10'), false);
});

test('evaluateCondition: truthy/falsy strings', () => {
  assert.equal(evaluateCondition('true'), true);
  assert.equal(evaluateCondition('false'), false);
  assert.equal(evaluateCondition(''), false);
  assert.equal(evaluateCondition('0'), false);
  assert.equal(evaluateCondition('hello'), true);
});

// ── slugify ───────────────────────────────────────────────────────────────────

test('slugify handles special characters', () => {
  assert.equal(slugify('Swagger Petstore'), 'swagger_petstore');
  assert.equal(slugify('My API v2!'), 'my_api_v2');
});

test('slugify truncates to 20 chars', () => {
  assert.ok(slugify('a'.repeat(50)).length <= 20);
});

test('slugify handles empty/null input', () => {
  assert.equal(slugify(''), 'api');
  assert.equal(slugify(null), 'api');
});

// ── isRegistryName ────────────────────────────────────────────────────────────

test('isRegistryName identifies plain names', () => {
  assert.equal(isRegistryName('github'), true);
  assert.equal(isRegistryName('stripe'), true);
  assert.equal(isRegistryName('coingecko'), true);
});

test('isRegistryName rejects URLs', () => {
  assert.equal(isRegistryName('https://petstore.swagger.io/v2/swagger.json'), false);
  assert.equal(isRegistryName('http://localhost:3000'), false);
});

test('isRegistryName rejects file paths', () => {
  assert.equal(isRegistryName('./my-api.json'), false);
  assert.equal(isRegistryName('/absolute/path.yaml'), false);
  assert.equal(isRegistryName('spec.json'), false);
});

// ── checkUnresolvedAuth ───────────────────────────────────────────────────────

test('checkUnresolvedAuth passes when all vars are resolved', () => {
  assert.doesNotThrow(() => checkUnresolvedAuth({ type: 'bearer', key: 'sk-actual-key' }, 'myapi'));
});

test('checkUnresolvedAuth throws on unresolved ${VAR}', () => {
  assert.throws(
    () => checkUnresolvedAuth({ type: 'bearer', key: '${STRIPE_SECRET_KEY}' }, 'stripe'),
    /STRIPE_SECRET_KEY/
  );
});

test('checkUnresolvedAuth error message includes set_api_auth instructions', () => {
  try {
    checkUnresolvedAuth({ type: 'bearer', key: '${MY_TOKEN}' }, 'myapi');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.message.includes('set_api_auth'));
    assert.ok(e.message.includes('MY_TOKEN'));
  }
});

test('checkUnresolvedAuth is safe with null/undefined auth', () => {
  assert.doesNotThrow(() => checkUnresolvedAuth(null, 'api'));
  assert.doesNotThrow(() => checkUnresolvedAuth(undefined, 'api'));
});
