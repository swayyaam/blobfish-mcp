import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Import from actual modules — safe since none of src/ connects to stdio
import { sanitizeDesc, scrubUrl, sanitizeError } from '../src/security.js';
import { slugify } from '../src/utils.js';
import { getCacheKey } from '../src/cache.js';
import { evaluateCondition } from '../src/workflow.js';
import { isRegistryName, checkUnresolvedAuth } from '../src/loaders/registry.js';
import { findDataArray, detectNextPage } from '../src/pagination.js';
import { updateRateLimit, waitIfRateLimited } from '../src/ratelimit.js';
import { rateLimitState } from '../src/state.js';
import { autoEnvLoad } from '../src/loaders/env.js';

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

// ── findDataArray ─────────────────────────────────────────────────────────────

test('findDataArray returns array input directly', () => {
  const arr = [1, 2, 3];
  assert.equal(findDataArray(arr), arr);
});

test('findDataArray finds top-level priority field: data', () => {
  const arr = [{ id: 1 }];
  assert.equal(findDataArray({ data: arr, total: 1 }), arr);
});

test('findDataArray finds top-level priority field: items', () => {
  const arr = ['a', 'b'];
  assert.equal(findDataArray({ items: arr }), arr);
});

test('findDataArray finds top-level priority field: results', () => {
  const arr = [{}];
  assert.equal(findDataArray({ results: arr, count: 1 }), arr);
});

test('findDataArray checks all other priority fields', () => {
  for (const key of ['records', 'rows', 'content', 'list', 'entries', 'objects', 'hits', 'members', 'values', 'payload', 'documents']) {
    const arr = [{ x: 1 }];
    assert.equal(findDataArray({ [key]: arr }), arr, `expected to find array at key "${key}"`);
  }
});

test('findDataArray checks nested data.items', () => {
  const arr = [{ id: 1 }];
  assert.equal(findDataArray({ data: { items: arr } }), arr);
});

test('findDataArray checks nested response.data', () => {
  const arr = [{ id: 1 }];
  assert.equal(findDataArray({ response: { data: arr } }), arr);
});

test('findDataArray skips SKIP_FIELDS (errors, warnings, messages, meta, links, included)', () => {
  const arr = [{ code: 'ERR' }];
  // Only skip fields present — real data under a non-skip key should be found
  const result = findDataArray({ errors: arr, warnings: arr, items: [{ id: 1 }] });
  assert.deepEqual(result, [{ id: 1 }]);
});

test('findDataArray returns null for null/non-object input', () => {
  assert.equal(findDataArray(null), null);
  assert.equal(findDataArray(undefined), null);
  assert.equal(findDataArray('string'), null);
  assert.equal(findDataArray(42), null);
});

test('findDataArray returns null when no array found', () => {
  assert.equal(findDataArray({ total: 10, page: 1 }), null);
});

test('findDataArray falls back to first non-skip non-empty array', () => {
  const arr = [{ id: 1 }];
  assert.equal(findDataArray({ custom_field: arr }), arr);
});

// ── detectNextPage ────────────────────────────────────────────────────────────

test('detectNextPage detects Link header rel=next', () => {
  const result = detectNextPage({}, { link: '<https://api.example.com/items?page=2>; rel="next"' }, {});
  assert.deepEqual(result, { type: 'url', url: 'https://api.example.com/items?page=2' });
});

test('detectNextPage detects Link header with capital key', () => {
  const result = detectNextPage({}, { Link: '<https://api.example.com/p2>; rel="next"' }, {});
  assert.equal(result?.type, 'url');
});

test('detectNextPage detects next_cursor field', () => {
  const result = detectNextPage({ next_cursor: 'abc123' }, {}, {});
  assert.deepEqual(result, { type: 'cursor', field: 'next_cursor', value: 'abc123' });
});

test('detectNextPage detects after field', () => {
  const result = detectNextPage({ after: 'tok_xyz' }, {}, {});
  assert.deepEqual(result, { type: 'cursor', field: 'after', value: 'tok_xyz' });
});

test('detectNextPage detects cursor in meta object', () => {
  const result = detectNextPage({ meta: { next_cursor: 'page2' } }, {}, {});
  assert.deepEqual(result, { type: 'cursor', field: 'next_cursor', value: 'page2' });
});

test('detectNextPage detects has_more:true with offset', () => {
  const result = detectNextPage({ has_more: true }, {}, { limit: 10, offset: 0 });
  assert.deepEqual(result, { type: 'offset', offset: 10, limit: 10 });
});

test('detectNextPage detects has_more:true with per_page fallback', () => {
  const result = detectNextPage({ has_more: true }, {}, { per_page: 25 });
  assert.deepEqual(result, { type: 'offset', offset: 25, limit: 25 });
});

test('detectNextPage detects total/offset/limit pattern', () => {
  const result = detectNextPage({ total: 100, offset: 0, limit: 20 }, {}, {});
  assert.deepEqual(result, { type: 'offset', offset: 20, limit: 20 });
});

test('detectNextPage returns null when offset+limit >= total', () => {
  const result = detectNextPage({ total: 20, offset: 0, limit: 20 }, {}, {});
  assert.equal(result, null);
});

test('detectNextPage returns null when no pagination signals', () => {
  assert.equal(detectNextPage({ data: [] }, {}, {}), null);
});

test('detectNextPage returns null for non-object data', () => {
  assert.equal(detectNextPage(null, {}, {}), null);
  assert.equal(detectNextPage('string', {}, {}), null);
});

// ── updateRateLimit ───────────────────────────────────────────────────────────

test('updateRateLimit sets state when remaining=0 and reset is Unix timestamp', () => {
  rateLimitState.delete('testapi');
  const futureTs = Math.floor(Date.now() / 1000) + 60; // 60 seconds from now (Unix epoch seconds)
  updateRateLimit('testapi', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(futureTs) });
  assert.ok(rateLimitState.has('testapi'));
  assert.ok(rateLimitState.get('testapi').blockedUntil > Date.now());
  rateLimitState.delete('testapi');
});

test('updateRateLimit sets state when remaining=1', () => {
  rateLimitState.delete('testapi2');
  const futureTs = Math.floor(Date.now() / 1000) + 30;
  updateRateLimit('testapi2', { 'x-ratelimit-remaining': '1', 'x-ratelimit-reset': String(futureTs) });
  assert.ok(rateLimitState.has('testapi2'));
  rateLimitState.delete('testapi2');
});

test('updateRateLimit does not set state when remaining > 1', () => {
  rateLimitState.delete('testapi3');
  updateRateLimit('testapi3', { 'x-ratelimit-remaining': '50', 'x-ratelimit-reset': '9999999999' });
  assert.equal(rateLimitState.has('testapi3'), false);
});

test('updateRateLimit does not set state when reset=0', () => {
  rateLimitState.delete('testapi4');
  updateRateLimit('testapi4', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '0' });
  assert.equal(rateLimitState.has('testapi4'), false);
});

test('updateRateLimit reads ratelimit-remaining header variant', () => {
  rateLimitState.delete('testapi5');
  const futureTs = Math.floor(Date.now() / 1000) + 10;
  updateRateLimit('testapi5', { 'ratelimit-remaining': '0', 'ratelimit-reset': String(futureTs) });
  assert.ok(rateLimitState.has('testapi5'));
  rateLimitState.delete('testapi5');
});

test('updateRateLimit reads x-rate-limit-remaining header variant', () => {
  rateLimitState.delete('testapi6');
  const futureTs = Math.floor(Date.now() / 1000) + 10;
  updateRateLimit('testapi6', { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(futureTs) });
  assert.ok(rateLimitState.has('testapi6'));
  rateLimitState.delete('testapi6');
});

// ── waitIfRateLimited ─────────────────────────────────────────────────────────

test('waitIfRateLimited does nothing when API is not rate-limited', async () => {
  rateLimitState.delete('clean-api');
  await waitIfRateLimited('clean-api'); // should resolve immediately
  assert.equal(rateLimitState.has('clean-api'), false);
});

test('waitIfRateLimited clears state when blockedUntil is already past', async () => {
  rateLimitState.set('past-api', { blockedUntil: Date.now() - 1000 });
  await waitIfRateLimited('past-api');
  assert.equal(rateLimitState.has('past-api'), false);
});

test('waitIfRateLimited clears state after a short real wait', async () => {
  rateLimitState.set('short-wait-api', { blockedUntil: Date.now() + 30 });
  await waitIfRateLimited('short-wait-api');
  assert.equal(rateLimitState.has('short-wait-api'), false);
});

// ── autoEnvLoad ───────────────────────────────────────────────────────────────

function makeTempRegistry(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blobfish-test-'));
  for (const [name, entry] of Object.entries(entries)) {
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(entry));
  }
  return dir;
}

test('autoEnvLoad returns 0 when registry dir does not exist', async () => {
  const result = await autoEnvLoad({ registryDir: '/tmp/blobfish-nonexistent-registry-xyzabc' });
  assert.equal(result, 0);
});

test('autoEnvLoad skips entries with no auth', async () => {
  const dir = makeTempRegistry({ public: { name: 'public', spec_url: 'https://example.com', title: 'Public' } });
  const calls = [];
  const result = await autoEnvLoad({ registryDir: dir, loader: async () => calls.push(1) });
  assert.equal(result, 0);
  assert.equal(calls.length, 0);
  fs.rmSync(dir, { recursive: true });
});

test('autoEnvLoad skips entries when required env var is absent', async () => {
  const dir = makeTempRegistry({
    myapi: { name: 'myapi', spec_url: 'https://example.com', title: 'My API', auth: { type: 'bearer', key: '${__BLOBFISH_TEST_VAR_ABSENT__}' } },
  });
  delete process.env.__BLOBFISH_TEST_VAR_ABSENT__;
  const calls = [];
  const result = await autoEnvLoad({ registryDir: dir, loader: async () => calls.push(1) });
  assert.equal(result, 0);
  assert.equal(calls.length, 0);
  fs.rmSync(dir, { recursive: true });
});

test('autoEnvLoad loads entry when all env vars are present', async () => {
  const dir = makeTempRegistry({
    myapi: { name: 'myapi', spec_url: 'https://example.com', title: 'My API', auth: { type: 'bearer', key: '${__BLOBFISH_TEST_VAR_SET__}' } },
  });
  process.env.__BLOBFISH_TEST_VAR_SET__ = 'test-key';
  const calls = [];
  const result = await autoEnvLoad({ registryDir: dir, loader: async () => calls.push(1) });
  assert.equal(result, 1);
  assert.equal(calls.length, 1);
  delete process.env.__BLOBFISH_TEST_VAR_SET__;
  fs.rmSync(dir, { recursive: true });
});

test('autoEnvLoad continues and counts successes when loader throws on one entry', async () => {
  const dir = makeTempRegistry({
    bad:  { name: 'bad',  spec_url: 'https://example.com/bad',  title: 'Bad',  auth: { type: 'bearer', key: '${__BF_TEST_A__}' } },
    good: { name: 'good', spec_url: 'https://example.com/good', title: 'Good', auth: { type: 'bearer', key: '${__BF_TEST_A__}' } },
  });
  process.env.__BF_TEST_A__ = 'val';
  let callCount = 0;
  const loader = async (url) => {
    callCount++;
    if (url.includes('bad')) throw new Error('simulated failure');
  };
  const result = await autoEnvLoad({ registryDir: dir, loader });
  assert.equal(callCount, 2);    // both attempted
  assert.equal(result, 1);       // only the good one counted
  delete process.env.__BF_TEST_A__;
  fs.rmSync(dir, { recursive: true });
});

test('autoEnvLoad skips already-loaded APIs', async () => {
  const { loadedApis } = await import('../src/state.js');
  const dir = makeTempRegistry({
    existing: { name: 'existing', spec_url: 'https://example.com', title: 'Existing', auth: { type: 'bearer', key: '${__BF_TEST_EXISTING__}' } },
  });
  process.env.__BF_TEST_EXISTING__ = 'val';
  loadedApis.set('existing', { tools: [] }); // simulate already loaded
  const calls = [];
  const result = await autoEnvLoad({ registryDir: dir, loader: async () => calls.push(1) });
  assert.equal(result, 0);
  assert.equal(calls.length, 0);
  loadedApis.delete('existing');
  delete process.env.__BF_TEST_EXISTING__;
  fs.rmSync(dir, { recursive: true });
});

// ── additional edge cases ─────────────────────────────────────────────────────

test('sanitizeDesc at exactly 300 chars is not truncated', () => {
  const s = 'a'.repeat(300);
  assert.equal(sanitizeDesc(s).length, 300);
});

test('sanitizeDesc handles unicode strings', () => {
  const s = '你好世界 — API description with unicode';
  assert.equal(sanitizeDesc(s), s);
});

test('scrubUrl redacts multiple credential params in one URL', () => {
  const url = 'https://api.example.com/data?api_key=MY_SECRET_KEY&access_token=MY_SECRET_TOKEN&limit=5';
  const scrubbed = decodeURIComponent(scrubUrl(url));
  assert.ok(!scrubbed.includes('MY_SECRET_KEY'), 'api_key value should be redacted');
  assert.ok(!scrubbed.includes('MY_SECRET_TOKEN'), 'access_token value should be redacted');
  assert.ok(scrubbed.includes('limit=5'), 'non-credential params should be preserved');
});

test('scrubUrl with no query string returns URL unchanged', () => {
  const url = 'https://api.example.com/data';
  assert.equal(scrubUrl(url), url);
});

test('scrubUrl redacts token param', () => {
  const scrubbed = decodeURIComponent(scrubUrl('https://api.example.com/?token=abc123'));
  assert.ok(!scrubbed.includes('abc123'));
});

test('getCacheKey produces different keys for different tools', () => {
  assert.notEqual(getCacheKey('tool_a', { x: 1 }), getCacheKey('tool_b', { x: 1 }));
});

test('getCacheKey with empty args object produces stable key', () => {
  assert.equal(getCacheKey('mytool', {}), getCacheKey('mytool', {}));
});

test('slugify strips leading and trailing special characters', () => {
  assert.equal(slugify('---api---'), 'api');
  assert.equal(slugify('!!!hello!!!'), 'hello');
});

test('slugify handles numbers-only string', () => {
  assert.equal(slugify('12345'), '12345');
});

test('slugify handles unicode by stripping non-ascii', () => {
  // unicode letters are not a-z, so they get replaced
  const result = slugify('café api');
  assert.ok(/^[a-z0-9_]+$/.test(result));
});

test('evaluateCondition trims whitespace around operators', () => {
  assert.equal(evaluateCondition('  404  ==  404  '), true);
  assert.equal(evaluateCondition('  10  >  5  '), true);
});

test('evaluateCondition handles null and undefined as falsy', () => {
  assert.equal(evaluateCondition('null'), false);
  assert.equal(evaluateCondition('undefined'), false);
});

// ── OAuth 2.0 client_credentials (1.3.0) ─────────────────────────────────────

import { getOAuthToken, invalidateOAuthToken } from '../src/oauth.js';
import { oauthTokens } from '../src/state.js';
import { resolveConfigPath, selectAuth, parseArgs, assertValidProfile } from '../src/config.js';

// Each test uses a unique token_url so the shared token cache never collides.
let oauthTestId = 0;
function makeOAuth(overrides = {}) {
  return {
    type: 'oauth2',
    token_url: `https://auth.example.com/token/${++oauthTestId}`,
    client_id: 'my-client',
    client_secret: 'my-secret',
    ...overrides,
  };
}

function tokenResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(body) };
}

test('getOAuthToken fetches a token and caches it', async () => {
  const auth = makeOAuth();
  let calls = 0;
  const fetchFn = async () => { calls++; return tokenResponse({ access_token: 'tok_1', expires_in: 3600 }); };
  assert.equal(await getOAuthToken(auth, { fetchFn }), 'tok_1');
  assert.equal(await getOAuthToken(auth, { fetchFn }), 'tok_1');
  assert.equal(calls, 1, 'second call should hit the cache');
});

test('getOAuthToken sends client credentials in the form body by default', async () => {
  const auth = makeOAuth({ scope: 'read write' });
  let captured;
  const fetchFn = async (url, init) => { captured = { url, init }; return tokenResponse({ access_token: 'tok_2' }); };
  await getOAuthToken(auth, { fetchFn });
  const body = new URLSearchParams(captured.init.body);
  assert.equal(captured.init.method, 'POST');
  assert.equal(body.get('grant_type'), 'client_credentials');
  assert.equal(body.get('client_id'), 'my-client');
  assert.equal(body.get('client_secret'), 'my-secret');
  assert.equal(body.get('scope'), 'read write');
  assert.equal(captured.init.headers['Content-Type'], 'application/x-www-form-urlencoded');
});

test('getOAuthToken supports HTTP Basic client auth', async () => {
  const auth = makeOAuth({ client_auth: 'basic' });
  let captured;
  const fetchFn = async (url, init) => { captured = init; return tokenResponse({ access_token: 'tok_3' }); };
  await getOAuthToken(auth, { fetchFn });
  const expected = 'Basic ' + Buffer.from('my-client:my-secret').toString('base64');
  assert.equal(captured.headers['Authorization'], expected);
  const body = new URLSearchParams(captured.body);
  assert.equal(body.get('client_secret'), null, 'secret must not also be in the body');
});

test('getOAuthToken refreshes when the token is near expiry', async () => {
  const auth = makeOAuth();
  let calls = 0;
  // expires_in 30s is inside the 60s refresh margin — every call refetches
  const fetchFn = async () => { calls++; return tokenResponse({ access_token: `tok_${calls}`, expires_in: 30 }); };
  assert.equal(await getOAuthToken(auth, { fetchFn }), 'tok_1');
  assert.equal(await getOAuthToken(auth, { fetchFn }), 'tok_2');
  assert.equal(calls, 2);
});

test('invalidateOAuthToken forces a refetch', async () => {
  const auth = makeOAuth();
  let calls = 0;
  const fetchFn = async () => { calls++; return tokenResponse({ access_token: `tok_${calls}`, expires_in: 3600 }); };
  await getOAuthToken(auth, { fetchFn });
  invalidateOAuthToken(auth);
  assert.equal(await getOAuthToken(auth, { fetchFn }), 'tok_2');
});

test('getOAuthToken single-flights concurrent requests', async () => {
  const auth = makeOAuth();
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    await new Promise(r => setTimeout(r, 20));
    return tokenResponse({ access_token: 'tok_shared', expires_in: 3600 });
  };
  const [a, b] = await Promise.all([getOAuthToken(auth, { fetchFn }), getOAuthToken(auth, { fetchFn })]);
  assert.equal(a, 'tok_shared');
  assert.equal(b, 'tok_shared');
  assert.equal(calls, 1, 'concurrent callers should share one token request');
});

test('getOAuthToken rejects config with missing fields and says how to fix it', async () => {
  await assert.rejects(
    () => getOAuthToken({ type: 'oauth2', token_url: 'https://auth.example.com/token' }),
    /missing "client_id"[\s\S]*set_api_auth/
  );
});

test('getOAuthToken surfaces token endpoint errors with the provider detail', async () => {
  const auth = makeOAuth();
  const fetchFn = async () => tokenResponse({ error: 'invalid_client', error_description: 'Client authentication failed' }, { ok: false, status: 401 });
  await assert.rejects(() => getOAuthToken(auth, { fetchFn }), /Client authentication failed/);
  assert.equal(oauthTokens.has(`${auth.token_url}|${auth.client_id}|`), false, 'failed fetch must not stay cached');
});

test('getOAuthToken blocks private token_url (SSRF)', async () => {
  const auth = makeOAuth({ token_url: 'http://127.0.0.1/token' });
  let calls = 0;
  await assert.rejects(() => getOAuthToken(auth, { fetchFn: async () => { calls++; } }), /SSRF/);
  assert.equal(calls, 0, 'fetch must never fire for a blocked URL');
});

// ── Environment profiles (1.3.0) ─────────────────────────────────────────────

test('resolveConfigPath returns blobfish.json when no profile is set', () => {
  assert.ok(resolveConfigPath('/app', null).endsWith('blobfish.json'));
});

test('resolveConfigPath prefers blobfish.<profile>.json when it exists', () => {
  const p = resolveConfigPath('/app', 'staging', (f) => f.endsWith('blobfish.staging.json'));
  assert.ok(p.endsWith('blobfish.staging.json'));
});

test('resolveConfigPath falls back to blobfish.json when the profile file is absent', () => {
  const p = resolveConfigPath('/app', 'staging', () => false);
  assert.ok(p.endsWith(path.sep + 'blobfish.json'));
});

test('assertValidProfile blocks path traversal in profile names', () => {
  assert.throws(() => assertValidProfile('../evil'), /Invalid profile name/);
  assert.throws(() => resolveConfigPath('/app', 'a/b', () => true), /Invalid profile name/);
  assert.equal(assertValidProfile('staging-2'), 'staging-2');
});

test('selectAuth picks the active profile and falls back to auth', () => {
  const entry = {
    auth: { type: 'bearer', key: '${PROD_KEY}' },
    auth_profiles: { staging: { type: 'bearer', key: '${STAGING_KEY}' } },
  };
  assert.equal(selectAuth(entry, 'staging').key, '${STAGING_KEY}');
  assert.equal(selectAuth(entry, 'production').key, '${PROD_KEY}');
  assert.equal(selectAuth(entry, null).key, '${PROD_KEY}');
  assert.equal(selectAuth({}, 'staging'), undefined);
});

test('parseArgs separates flags from positional spec URLs', () => {
  const { flags, positional } = parseArgs(['--http', '--profile', 'staging', 'https://x.dev/openapi.json']);
  assert.equal(flags.http, true);
  assert.equal(flags.profile, 'staging');
  assert.deepEqual(positional, ['https://x.dev/openapi.json']);
});

test('parseArgs with no args yields empty flags and positional', () => {
  assert.deepEqual(parseArgs([]), { flags: {}, positional: [] });
});
