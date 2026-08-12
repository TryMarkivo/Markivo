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

// Regression: the live Path A payload carries EXPLICIT nulls for the two fields
// Places cannot measure. The test above only proves omitted fields survive
// (`+undefined` is NaN); an explicit null took the `+null === 0` branch and was
// persisted as a fabricated 0, which the UI then rendered as "0 posts / week".
test('construct keeps explicit null competitor metrics null, never 0', async () => {
  const token = await register('nullcomp');
  const res = await post('/api/onboarding/construct', {
    businessName: 'Null Metrics Biz',
    // places.js maps an unrated business to `rating: null` — the normal case
    // for a brand-new SMB that has no Google reviews yet.
    google: { placeId: 'pid_n', rating: null, reviewsCount: null },
    competitors: [
      // Byte-for-byte the shape places.findCompetitors returns.
      { competitorName: 'Nulla Cafe', rating: null, followersCount: null, postsPerWeek: null, platformsDetected: ['google'] },
    ],
  }, token);
  assert.strictEqual(res.status, 200);
  const { profile } = await res.json();
  assert.strictEqual(profile.googleRating, null, 'an unrated business must not become ★ 0');
  assert.strictEqual(profile.googleReviewsCount, null);

  const stats = await (await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.strictEqual(stats.competitors.length, 1);
  const [c] = stats.competitors;
  assert.strictEqual(c.name, 'Nulla Cafe');
  assert.strictEqual(c.postsPerWeek, null, 'unknown cadence must stay null, not 0');
  assert.strictEqual(c.followers, null, 'unknown follower count must stay null, not 0');
  assert.strictEqual(c.rating, null, 'unrated place must stay null, not 0');
});

// Path A resolves lat/lng/primaryType during the scan but used to drop them on
// submit, which is why competitors could never be refreshed afterwards.
test('construct persists the scan location and competitor placeIds', async () => {
  const token = await register('geo');
  const res = await post('/api/onboarding/construct', {
    businessName: 'Geo Cafe',
    google: { placeId: 'pid_geo', rating: 4.2, reviewsCount: 30, lat: 41.311, lng: 69.279, primaryType: 'coffee_shop' },
    competitors: [
      { competitorName: 'Nearby One', rating: 4.4, placeId: 'pid_n1', address: 'Mirzo 3', platformsDetected: ['google'] },
    ],
  }, token);
  assert.strictEqual(res.status, 200);
  const { profile } = await res.json();
  assert.strictEqual(profile.googleLat, 41.311);
  assert.strictEqual(profile.googleLng, 69.279);
  assert.strictEqual(profile.googlePrimaryType, 'coffee_shop');

  // The competitor keeps the identity a later refresh needs to match on.
  const { competitors } = await (await fetch(`${base}/api/competitors`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const row = competitors.find((c) => c.name === 'Nearby One');
  assert.strictEqual(row.placeId, 'pid_n1');
  assert.strictEqual(row.address, 'Mirzo 3');
  assert.strictEqual(row.source, 'google_places');
});

// Path B (from scratch) and keyless mode start with NO competitors. Onboarding
// used to seed three invented benchmarks with invented follower counts, which
// the dashboard then showed as this owner's real local competition.
test('construct without competitors starts empty rather than seeding fakes', async () => {
  const token = await register('seedcomp');
  const res = await post('/api/onboarding/construct', { businessName: 'Scratch Biz' }, token);
  assert.strictEqual(res.status, 200);
  const { profile } = await res.json();
  assert.strictEqual(profile.googlePlaceId, null);

  const stats = await (await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.deepStrictEqual(stats.competitors, [], 'no demo substitution either');
});

test('construct drops malformed competitor payloads without inventing replacements', async () => {
  const token = await register('badcomp');
  const res = await post('/api/onboarding/construct', {
    businessName: 'Sanitize Biz',
    competitors: [{ rating: 5 }, 'junk', null], // no usable names
  }, token);
  assert.strictEqual(res.status, 200);

  const stats = await (await fetch(`${base}/api/dashboard/stats`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.deepStrictEqual(stats.competitors, []);
});
