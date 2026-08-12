const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// GOOGLE_MAPS_API_KEY is deliberately ABSENT: this suite asserts keyless
// (mock) behavior. Live-mode mapping is covered in places.live.test.js,
// which runs in its own process (node --test isolates per file).
const TMP_DB = path.join(os.tmpdir(), `markivo-places-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.SCAN_RATE_LIMIT = '100'; // never trip the limiter in tests
delete process.env.GOOGLE_MAPS_API_KEY;

const places = require('../places');
const { validateScan } = require('../validators');
const { app } = require('../server');

// ---------------------------------------------------------------------------
// Unit: keyless fallback
// ---------------------------------------------------------------------------

test('scanBusiness (keyless) returns the legacy mock shape without touching the network', async () => {
  const neverFetch = () => assert.fail('keyless mode must not perform network calls');
  const r = await places.scanBusiness({ businessName: 'Noir Coffee', location: 'Tashkent' }, { fetchImpl: neverFetch });

  assert.strictEqual(r.live, false);
  const { alternatives, ...topMatch } = r.googleBusiness;
  assert.deepStrictEqual(topMatch, {
    found: true, name: 'Noir Coffee on Google Maps', rating: 4.8, reviewsCount: 14,
    address: 'Tashkent, Uzbekistan', verified: true,
  });

  // Mock now ships 2 deterministic alternatives with the FULL mapped field
  // set, so the "is this your business?" UI flow is testable without a key.
  assert.strictEqual(alternatives.length, 2);
  for (const alt of alternatives) {
    assert.strictEqual(typeof alt.placeId, 'string');
    assert.strictEqual(typeof alt.rating, 'number');
    for (const field of ['name', 'reviewsCount', 'address', 'verified', 'website', 'phone', 'mapsUrl', 'location', 'primaryType', 'category']) {
      assert.ok(field in alt, `alternative missing field: ${field}`);
    }
  }
  assert.strictEqual(alternatives[0].placeId, 'mock_noircoffee_alt_1');
  assert.strictEqual(alternatives[0].name, 'Noir Coffee Center');

  assert.strictEqual(r.instagram.found, true);
  assert.strictEqual(r.instagram.handle, '@noircoffee_uz');
  assert.strictEqual(r.telegram.found, true);
  assert.strictEqual(r.telegram.channel, '@noircoffee');
  assert.strictEqual(r.aiSearchPresence.perplexityScore, 72);
  assert.deepStrictEqual(r.competitors, []);
});

test('humanizeType converts snake_case place types', () => {
  assert.strictEqual(places.humanizeType('coffee_shop'), 'Coffee Shop');
  assert.strictEqual(places.humanizeType('restaurant'), 'Restaurant');
  assert.strictEqual(places.humanizeType(null), null);
});

// ---------------------------------------------------------------------------
// Unit: validateScan
// ---------------------------------------------------------------------------

test('validateScan enforces length-only rules (Cyrillic passes)', () => {
  assert.ok(validateScan({}));
  assert.ok(validateScan({ businessName: 'a' }));
  assert.ok(validateScan({ businessName: 'x'.repeat(101) }));
  assert.ok(validateScan({ businessName: 'Noir', location: 'y'.repeat(101) }));
  assert.strictEqual(validateScan({ businessName: 'Noir', location: '' }), null);
  assert.strictEqual(validateScan({ businessName: '  Noir  ' }), null);
  assert.strictEqual(validateScan({ businessName: 'Чайхана Навруз', location: 'Ташкент' }), null);
});

// ---------------------------------------------------------------------------
// Endpoint integration (keyless server)
// ---------------------------------------------------------------------------

let server, base;

const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

const register = async (tag) => {
  const res = await post('/api/auth/register', { email: `${tag}${Date.now()}@m.uz`, password: 'secret123', fullName: 'P' });
  return (await res.json()).accessToken;
};

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('POST /api/discovery/scan requires auth and validates input', async () => {
  const noAuth = await post('/api/discovery/scan', { businessName: 'Noir' });
  assert.strictEqual(noAuth.status, 401);

  const token = await register('scanval');
  const tooShort = await post('/api/discovery/scan', { businessName: 'x' }, token);
  assert.strictEqual(tooShort.status, 400);

  const ok = await post('/api/discovery/scan', { businessName: 'Noir Coffee' }, token);
  assert.strictEqual(ok.status, 200);
  const data = await ok.json();
  assert.strictEqual(data.live, false);
  assert.strictEqual(data.googleBusiness.found, true);
  assert.strictEqual(data.googleBusiness.rating, 4.8);
});

test('POST /api/discovery/competitors: keyless → empty list; validates input; requires auth', async () => {
  const noAuth = await post('/api/discovery/competitors', { lat: 41.3, lng: 69.2, primaryType: 'coffee_shop' });
  assert.strictEqual(noAuth.status, 401);

  const token = await register('comp');

  const missingLat = await post('/api/discovery/competitors', { lng: 69.2, primaryType: 'coffee_shop' }, token);
  assert.strictEqual(missingLat.status, 400);

  const badType = await post('/api/discovery/competitors', { lat: 41.3, lng: 69.2, primaryType: 'x' }, token);
  assert.strictEqual(badType.status, 400);

  const ok = await post('/api/discovery/competitors', { lat: 41.3, lng: 69.2, primaryType: 'coffee_shop' }, token);
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await ok.json(), { competitors: [] }); // keyless: honest empty
});

test('construct stores google identity and real competitors replace the seeds', async () => {
  const token = await register('realcomp');
  const res = await post('/api/onboarding/construct', {
    businessName: 'Noir Coffee',
    category: 'Coffee Shop',
    platforms: { googleBusiness: true },
    google: { placeId: 'pid_x', rating: 4.6, reviewsCount: 89 },
    competitors: [
      { competitorName: 'Rival Cafe', rating: 4.4, platformsDetected: ['google'] },
      { competitorName: 'Bistro Nine', rating: 4.1, platformsDetected: ['google'] },
    ],
  }, token);
  assert.strictEqual(res.status, 200);
  const { profile } = await res.json();
  assert.strictEqual(profile.googlePlaceId, 'pid_x');
  assert.strictEqual(profile.googleRating, 4.6);
  assert.strictEqual(profile.googleReviewsCount, 89);

  const stats = await (await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.strictEqual(stats.competitors.length, 2);
  assert.deepStrictEqual(stats.competitors.map((c) => c.name).sort(), ['Bistro Nine', 'Rival Cafe']);
  assert.strictEqual(stats.competitors[0].postsPerWeek, null); // honest nulls survive the API
});

test('construct without competitors leaves the benchmark honestly empty (no fake seeds)', async () => {
  const token = await register('seedcomp');
  const res = await post('/api/onboarding/construct', { businessName: 'Scratch Biz' }, token);
  assert.strictEqual(res.status, 200);
  const { profile } = await res.json();
  assert.strictEqual(profile.googlePlaceId, null);

  const stats = await (await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.deepStrictEqual(stats.competitors, []);
});

test('construct sanitizes malformed competitor payloads down to nothing (honest empty, not fake seeds)', async () => {
  const token = await register('badcomp');
  const res = await post('/api/onboarding/construct', {
    businessName: 'Sanitize Biz',
    competitors: [{ rating: 5 }, 'junk', null], // no usable names → nothing survives sanitization
  }, token);
  assert.strictEqual(res.status, 200);

  const stats = await (await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.deepStrictEqual(stats.competitors, []);
});
