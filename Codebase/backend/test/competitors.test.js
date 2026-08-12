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

// Onboarding no longer seeds invented benchmarks, so a brand-new business
// genuinely starts at zero and the panel must say so rather than look broken.
test('a freshly onboarded business starts with no competitors and a noCompetitors gap', async () => {
  const fresh = await register('freshbiz');
  await post('/api/onboarding/construct', { businessName: 'Fresh Biz', category: 'Cafe' }, fresh);

  const data = await (await get('/api/competitors', fresh)).json();
  assert.deepStrictEqual(data.competitors, [], 'no seeded placeholders');
  assert.deepStrictEqual(data.gaps.map((g) => g.code), ['noCompetitors']);
  assert.ok(data.you, 'the "you" row still renders — we know things about ourselves');
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

test('the "you" row is measured from our own records, with honest nulls', async () => {
  const { you } = await (await get('/api/competitors', token)).json();

  assert.strictEqual(you.name, 'Noir Coffee');
  assert.strictEqual(you.postsPerWeekBasis, 'markivo');
  assert.strictEqual(you.sampleDays, 28);
  // Our own output is knowable, so 0 here is a fact — unlike a competitor null.
  assert.strictEqual(typeof you.postsPerWeek, 'number');
  assert.strictEqual(you.publishedCount, 0);

  // No platform is actually connected in this suite.
  assert.strictEqual(you.followers, null, 'no connection means not reported, not a demo number');
  assert.strictEqual(you.followersLive, false);
  assert.ok(you.unavailable.includes('followers'));

  // A wizard checkbox is not a connection.
  assert.strictEqual(you.channels.connected, 0);
  assert.ok(you.channels.selectedAtSetup >= 1, 'what was picked at setup is still reported, separately');
});

test('gaps arrive as translatable codes with metrics', async () => {
  const { gaps } = await (await get('/api/competitors', token)).json();
  assert.ok(gaps.length > 0, 'a profile with competitors produces at least one gap');
  for (const g of gaps) {
    assert.match(g.code, /^[a-zA-Z]+$/, 'a code, never a server-assembled sentence');
    assert.ok(['warn', 'info'].includes(g.severity));
    assert.strictEqual(typeof g.metrics, 'object');
  }
});

test('POST /refresh keyless: 200 with a reason code, and nothing mutates', async () => {
  const before = await listRows();
  const res = await post('/api/competitors/refresh', {}, token);

  assert.strictEqual(res.status, 200, 'a missing key degrades the answer, never the route');
  const data = await res.json();
  assert.strictEqual(data.refreshed, 0);
  assert.strictEqual(data.added, 0);
  assert.strictEqual(data.updated, 0);
  assert.strictEqual(data.reason, 'no_api_key');
  assert.match(data.reason, /^[a-z_]+$/, 'reason must be a translatable code');
  assert.strictEqual(data.discovery.available, false);

  const after = await listRows();
  assert.strictEqual(after.length, before.length, 'a keyless refresh must not touch stored rows');
});

test('POST /:id/enrich reports per-source codes and writes nothing it could not read', async () => {
  const created = await (await post('/api/competitors', {
    name: 'Enrich Target', telegramChannel: 'https://t.me/sometarget', instagramHandle: 'sometarget',
  }, token)).json();

  const res = await post(`/api/competitors/${created.id}/enrich`, {}, token);
  assert.strictEqual(res.status, 200, 'nothing readable is information, not an error');
  const data = await res.json();

  // No Telegram bot is connected in this suite, and Instagram needs an auth
  // upgrade — two different reasons, reported separately.
  assert.strictEqual(data.report.telegram.ok, false);
  assert.strictEqual(data.report.telegram.reason, 'no_telegram_bot');
  assert.strictEqual(data.report.instagram.reason, 'auth_upgrade_required');

  assert.strictEqual(data.competitor.followers, null, 'an unreadable source writes no number');
  assert.ok(data.competitor.unavailable.includes('followers'));
  assert.deepStrictEqual(data.competitor.metricSources, {}, 'nothing was measured, so nothing is attributed');
});

test('enrich on another profile\'s competitor answers 404', async () => {
  const mine = await findRow('Enrich Target');
  assert.strictEqual((await post(`/api/competitors/${mine.id}/enrich`, {}, otherToken)).status, 404);
});

test('GET /insights before any run returns nothing, and costs nothing', async () => {
  const data = await (await get('/api/competitors/insights', token)).json();
  assert.strictEqual(data.brief, null);
  assert.strictEqual(data.generatedAt, null);
});

test('POST /insights keyless produces a full-contract brief with visible caveats', async () => {
  const res = await post('/api/competitors/insights', {}, token);
  assert.strictEqual(res.status, 200, 'a blank Gemini key degrades the answer, not the route');
  const { brief } = await res.json();

  assert.strictEqual(brief.engine, 'template');
  for (const field of ['marketSnapshot', 'trendingAngles', 'seasonalHooks', 'competitorPlaybook', 'contentGaps', 'localNotes', 'groundingFlags']) {
    assert.ok(field in brief, `the offline brief must satisfy the full contract: missing ${field}`);
  }
  assert.ok(brief.marketSnapshot.length > 40);
  assert.ok(brief.groundingFlags.length > 0, 'an offline brief must declare that it is offline');
  assert.match(brief.groundingFlags[0], /offline/i);

  // The prompt bans naming competitors; the template must not either.
  const playbook = brief.competitorPlaybook.join(' ');
  assert.ok(!playbook.includes('Brew District'), 'the playbook describes patterns, never a named rival');

  // Every angle it cannot verify is marked as such.
  for (const a of brief.trendingAngles) {
    assert.ok(['high', 'medium', 'low'].includes(a.confidence));
  }
});

test('POST /insights caches, and GET returns the cached brief', async () => {
  const first = await (await post('/api/competitors/insights', { topic: 'winter menu' }, token)).json();
  const cached = await (await get('/api/competitors/insights', token)).json();
  assert.strictEqual(cached.brief.engine, 'template');
  assert.strictEqual(cached.generatedAt, first.generatedAt);
  assert.deepStrictEqual(cached.brief.marketSnapshot, first.brief.marketSnapshot);
});

test('a competitor name in Cyrillic passes validation untouched', async () => {
  const res = await post('/api/competitors', { name: 'Кофейня Улица', rating: 4.2 }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).name, 'Кофейня Улица');
});
