const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Live-mode ROUTE tests for the competitor refresh.
//
// places.live.test.js covers the module through its fetchImpl seam, but the
// route calls places.* without one, so the interesting logic — dedup on
// re-refresh, not clobbering owner-entered numbers, and the one-call cost
// envelope — is only reachable by stubbing global fetch. Everything that is
// not a Places URL is passed through to the real fetch, because this suite
// still needs it to talk to its own server.
//
// The key must be set BEFORE requiring the app (config caches env at load);
// node --test gives each file its own process, so it never leaks.
const TMP_DB = path.join(os.tmpdir(), `markivo-competitors-live-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_MAPS_API_KEY = 'test_key';
process.env.SCAN_RATE_LIMIT = '100';

const { app } = require('../server');

const SELF = {
  id: 'pid_self',
  displayName: { text: 'Noir Coffee' },
  formattedAddress: 'Amir Temur 12, Tashkent',
  location: { latitude: 41.311, longitude: 69.279 },
  primaryType: 'coffee_shop',
  businessStatus: 'OPERATIONAL',
  rating: 4.6,
  userRatingCount: 89,
};
// The nearby response deliberately includes the business itself, which must be
// filtered out, and more rows than findCompetitors' limit of 3.
const NEARBY = {
  places: [
    { id: 'pid_self', displayName: { text: 'Noir Coffee' }, rating: 4.6 },
    { id: 'pid_3', displayName: { text: 'Brew District' }, formattedAddress: 'Mirzo 3', rating: 4.5 },
    { id: 'pid_4', displayName: { text: 'Kofe Hona' }, formattedAddress: 'Chilanzar 9', rating: 4.3 },
    { id: 'pid_5', displayName: { text: 'Cup & Co' }, formattedAddress: 'Yunusobod 1', rating: 4.2 },
  ],
};

const realFetch = globalThis.fetch;
let googleCalls = [];

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://places.googleapis.com/')) {
    googleCalls.push(u);
    const body = u.includes(':searchNearby') ? NEARBY : { places: [SELF] };
    return { ok: true, status: 200, json: async () => body };
  }
  return realFetch(url, opts);
};

let server, base;

const post = (p, body, tk) =>
  realFetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify(body),
  });
const put = (p, body, tk) =>
  realFetch(base + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, tk) => realFetch(base + p, { headers: tk ? { Authorization: `Bearer ${tk}` } : {} });

const register = async (label) => {
  const email = `${label}${Date.now()}${Math.random().toString(16).slice(2)}@markivo.uz`;
  return (await (await post('/api/auth/register', { email, password: 'secret123', fullName: label })).json()).accessToken;
};
const listRows = async (tk) => (await (await get('/api/competitors', tk)).json()).competitors;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  globalThis.fetch = realFetch;
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

// A profile that already carries the scan location — the steady state.
const onboardWithLocation = async (label) => {
  const tk = await register(label);
  await post('/api/onboarding/construct', {
    businessName: 'Noir Coffee', category: 'Coffee Shop',
    google: { placeId: 'pid_self', rating: 4.6, reviewsCount: 89, lat: 41.311, lng: 69.279, primaryType: 'coffee_shop' },
  }, tk);
  return tk;
};

test('refresh costs ONE upstream call, excludes the business itself, and caps at 3', async () => {
  const tk = await onboardWithLocation('live');
  googleCalls = [];

  const res = await post('/api/competitors/refresh', {}, tk);
  assert.strictEqual(res.status, 200);
  const data = await res.json();

  assert.strictEqual(googleCalls.length, 1, 'steady state is a single Places call');
  assert.ok(googleCalls[0].includes(':searchNearby'));

  assert.strictEqual(data.reason, null);
  assert.strictEqual(data.added, 3, 'findCompetitors caps the list at 3');
  assert.strictEqual(data.updated, 0);
  assert.strictEqual(data.discovery.available, true);

  const names = data.competitors.map((c) => c.name);
  assert.ok(names.includes('Brew District'));
  assert.ok(!names.includes('Noir Coffee'), 'the business itself is excluded');

  // What Places genuinely returns, and what it cannot.
  const brew = data.competitors.find((c) => c.name === 'Brew District');
  assert.strictEqual(brew.rating, 4.5);
  assert.strictEqual(brew.address, 'Mirzo 3');
  assert.strictEqual(brew.source, 'google_places');
  assert.strictEqual(brew.followers, null, 'Places cannot report followers');
  assert.strictEqual(brew.postsPerWeek, null, 'Places cannot report cadence');
  assert.deepStrictEqual(brew.unavailable.sort(), ['followers', 'postsPerWeek']);
  assert.ok(brew.refreshed_at);
});

test('a second refresh updates in place and never duplicates', async () => {
  const tk = await onboardWithLocation('live2');
  await post('/api/competitors/refresh', {}, tk);
  const first = await listRows(tk);

  const second = await (await post('/api/competitors/refresh', {}, tk)).json();
  assert.strictEqual(second.added, 0, 'the same places must not be re-added');
  assert.strictEqual(second.updated, 3);
  assert.strictEqual(second.competitors.length, first.length);
});

test('refresh never overwrites what the owner entered by hand', async () => {
  const tk = await onboardWithLocation('live3');
  await post('/api/competitors/refresh', {}, tk);

  const brew = (await listRows(tk)).find((c) => c.name === 'Brew District');
  await put(`/api/competitors/${brew.id}`, {
    followersCount: 4100, postsPerWeek: 6, notes: 'reels daily', telegramChannel: '@brew',
  }, tk);

  await post('/api/competitors/refresh', {}, tk);

  const after = (await listRows(tk)).find((c) => c.name === 'Brew District');
  assert.strictEqual(after.followers, 4100, 'owner-entered followers survive a refresh');
  assert.strictEqual(after.postsPerWeek, 6, 'owner-entered cadence survives a refresh');
  assert.strictEqual(after.notes, 'reels daily');
  assert.strictEqual(after.telegramChannel, '@brew');
  assert.strictEqual(after.rating, 4.5, 'the Places-owned field still refreshes');
  assert.strictEqual(after.metricSources.followers, 'manual');
});

test('a legacy profile with no stored location re-resolves once, then costs one call', async () => {
  const tk = await register('legacy');
  // Onboarded the way Path A used to submit: placeId but no lat/lng/primaryType.
  await post('/api/onboarding/construct', {
    businessName: 'Noir Coffee', category: 'Coffee Shop',
    google: { placeId: 'pid_self', rating: 4.6, reviewsCount: 89 },
  }, tk);

  const before = await (await get('/api/competitors', tk)).json();
  assert.strictEqual(before.discovery.available, false);
  assert.strictEqual(before.discovery.reason, 'no_location');

  googleCalls = [];
  const first = await (await post('/api/competitors/refresh', {}, tk)).json();
  assert.strictEqual(googleCalls.length, 2, 'one re-resolve + one nearby search');
  assert.ok(googleCalls[0].includes(':searchText'));
  assert.ok(googleCalls[1].includes(':searchNearby'));
  assert.strictEqual(first.added, 3);
  assert.strictEqual(first.discovery.available, true, 'the location is now stored');

  // The re-resolve was persisted, so the next refresh is back to one call.
  googleCalls = [];
  await post('/api/competitors/refresh', {}, tk);
  assert.strictEqual(googleCalls.length, 1, 'the stored location makes this a single call');
});
