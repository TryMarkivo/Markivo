const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
// GOOGLE_MAPS_API_KEY is deleted so this file always exercises the KEYLESS path:
// discovery reports itself unavailable and refresh is a no-op, but every CRUD
// route must stay fully functional — a blank credential degrades the answer,
// never the route.
const TMP_DB = path.join(os.tmpdir(), `markivo-competitors-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
delete process.env.GOOGLE_MAPS_API_KEY;
// The refresh route carries scanLimiter; without this the suite trips its own
// rate limit partway through.
process.env.SCAN_RATE_LIMIT = '100';

const { app } = require('../server');

let server, base, token, otherToken;

const post = (p, body, tk) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify(body),
  });
const put = (p, body, tk) =>
  fetch(base + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, tk) => fetch(base + p, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });
const del = (p, tk) => fetch(base + p, { method: 'DELETE', headers: tk ? { Authorization: `Bearer ${tk}` } : {} });

const register = async (label) => {
  const email = `${label}${Date.now()}${Math.random().toString(16).slice(2)}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: label })).json();
  return reg.accessToken;
};

// Onboarding still seeds benchmark placeholder rows (removed in a later commit),
// so every assertion here addresses a competitor BY NAME and compares relative
// counts. That keeps this suite meaningful both before and after the seeds go.
const listRows = async (tk = token) => (await (await get('/api/competitors', tk)).json()).competitors;
const findRow = async (name, tk = token) => (await listRows(tk)).find((c) => c.name === name);

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  token = await register('comp');
  await post('/api/onboarding/construct', {
    businessName: 'Noir Coffee', category: 'Coffee Shop',
    platforms: { googleBusiness: true, instagram: true },
  }, token);

  // A second business, used for the cross-profile isolation checks.
  otherToken = await register('other');
  await post('/api/onboarding/construct', { businessName: 'Rival Corp', category: 'Coffee Shop' }, otherToken);
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('GET /api/competitors requires auth', async () => {
  assert.strictEqual((await get('/api/competitors')).status, 401);
});

test('GET before onboarding answers an empty envelope, not a 404', async () => {
  const fresh = await register('noprofile');
  const res = await get('/api/competitors', fresh);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.deepStrictEqual(data.competitors, []);
  assert.deepStrictEqual(data.gaps, []);
  assert.strictEqual(data.you, null);
  assert.strictEqual(data.discovery.available, false);
});

test('keyless discovery reports a reason CODE, not a sentence', async () => {
  const { discovery } = await (await get('/api/competitors', token)).json();
  assert.strictEqual(discovery.available, false);
  assert.strictEqual(discovery.reason, 'no_api_key');
  assert.match(discovery.reason, /^[a-z_]+$/, 'reason must be a translatable code');
  assert.strictEqual(discovery.lastRefreshedAt, null);
});

test('POST creates a competitor; a blank metric stays null, never 0', async () => {
  const res = await post('/api/competitors', {
    name: 'Brew District',
    rating: 4.5,
    followersCount: '',   // owner left it blank — unknown, not zero
    postsPerWeek: null,   // explicitly unknown
    address: 'Mirzo Ulugbek 3',
    platformsDetected: ['google', 'instagram'],
  }, token);
  assert.strictEqual(res.status, 200);
  const row = await res.json();

  assert.strictEqual(row.name, 'Brew District');
  assert.strictEqual(row.rating, 4.5);
  assert.strictEqual(row.followers, null, 'a blank form field means unknown, not 0');
  assert.strictEqual(row.postsPerWeek, null);
  assert.strictEqual(row.platformCount, 2);
  assert.strictEqual(row.source, 'manual');
  assert.deepStrictEqual(row.unavailable.sort(), ['followers', 'postsPerWeek']);
  // Only the value the owner actually supplied is attributed to them.
  assert.deepStrictEqual(row.metricSources, { rating: 'manual' });
});

test('POST rejects a blank name and an out-of-range rating', async () => {
  const noName = await post('/api/competitors', { name: 'x' }, token);
  assert.strictEqual(noName.status, 400);

  const badRating = await post('/api/competitors', { name: 'Rating Nine', rating: 9 }, token);
  assert.strictEqual(badRating.status, 400);

  const badCadence = await post('/api/competitors', { name: 'Fast Poster', postsPerWeek: 500 }, token);
  assert.strictEqual(badCadence.status, 400);
});

test('POST refuses a duplicate name for the same profile', async () => {
  const dupe = await post('/api/competitors', { name: '  brew district  ' }, token);
  assert.strictEqual(dupe.status, 409);
});

test('GET lists the row and flags only genuinely-missing metrics', async () => {
  const row = await findRow('Brew District');
  assert.ok(row, 'the created competitor is listed');
  assert.ok(!row.unavailable.includes('rating'), 'a known rating is not "unavailable"');
});

test('PUT edits a competitor; a partial body leaves siblings alone', async () => {
  const { id } = await findRow('Brew District');

  // Owner researched the cadence by hand.
  const res = await put(`/api/competitors/${id}`, { postsPerWeek: 6, notes: 'reels daily' }, token);
  assert.strictEqual(res.status, 200);
  const row = await res.json();
  assert.strictEqual(row.postsPerWeek, 6);
  assert.strictEqual(row.notes, 'reels daily');
  assert.strictEqual(row.rating, 4.5, 'an omitted field keeps its stored value');
  assert.strictEqual(row.metricSources.postsPerWeek, 'manual');
  assert.ok(!row.unavailable.includes('postsPerWeek'));
});

test('PUT with an explicit null resets a metric back to unknown', async () => {
  const { id } = await findRow('Brew District');

  const row = await (await put(`/api/competitors/${id}`, { postsPerWeek: null }, token)).json();
  assert.strictEqual(row.postsPerWeek, null);
  assert.ok(row.unavailable.includes('postsPerWeek'));
  assert.strictEqual(row.metricSources.postsPerWeek, undefined, 'nobody vouches for an unknown value');
  assert.strictEqual(row.rating, 4.5, 'resetting one metric does not touch another');
});

test('PUT and DELETE on another profile\'s competitor answer 404', async () => {
  const { id } = await findRow('Brew District');

  assert.strictEqual((await put(`/api/competitors/${id}`, { notes: 'peeking' }, otherToken)).status, 404);
  assert.strictEqual((await del(`/api/competitors/${id}`, otherToken)).status, 404);

  // And the row is untouched.
  assert.strictEqual((await findRow('Brew District')).notes, 'reels daily');
  // The other profile never sees it at all.
  assert.strictEqual(await findRow('Brew District', otherToken), undefined);
});

test('DELETE removes the caller\'s own competitor', async () => {
  const before = await listRows();
  const { id } = before.find((c) => c.name === 'Brew District');

  assert.strictEqual((await del(`/api/competitors/${id}`, token)).status, 200);

  const after = await listRows();
  assert.strictEqual(after.length, before.length - 1);
  assert.strictEqual(after.find((c) => c.name === 'Brew District'), undefined);
});

test('a competitor name in Cyrillic passes validation untouched', async () => {
  const res = await post('/api/competitors', { name: 'Кофейня Улица', rating: 4.2 }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).name, 'Кофейня Улица');
});
