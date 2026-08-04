const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Set env BEFORE requiring the app — config caches env at load.
const TMP_DB = path.join(os.tmpdir(), `markivo-mh-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const createDb = require('../db');
const { app } = require('../server');

// A second connection to the SAME file the server uses, so the data-layer
// assertions below see exactly what the routes wrote.
const db = createDb(TMP_DB);

let server, base, access, profileId;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await post('/api/auth/register', { email: `mh${Date.now()}@m.uz`, password: 'secret123', fullName: 'MH Owner' });
  const body = await reg.json();
  access = body.accessToken;
  const prof = await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm', slogan: 'x',
  }, access);
  profileId = (await prof.json()).profile.id;
});
after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) => fetch(base + p, { headers: { Authorization: `Bearer ${token}` } });

test('every dashboard metric carries a recorded history series', async () => {
  const res = await get('/api/dashboard/stats', access);
  assert.strictEqual(res.status, 200);
  const { metrics } = await res.json();

  for (const key of ['googleViews', 'instagramFollowers', 'telegramSubscribers']) {
    assert.ok(Array.isArray(metrics[key].history), `${key} should carry a history array`);
    assert.strictEqual(metrics[key].history.length, 1, `${key} should have today's reading`);
    assert.strictEqual(metrics[key].history[0].value, metrics[key].current);
    assert.match(metrics[key].history[0].day, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('fetching the dashboard repeatedly does not stack duplicate days', async () => {
  await get('/api/dashboard/stats', access);
  await get('/api/dashboard/stats', access);
  const { metrics } = await (await get('/api/dashboard/stats', access)).json();
  // The dashboard is opened many times a day; only the latest reading for a
  // given day survives, so the series stays one point per day.
  assert.strictEqual(metrics.googleViews.history.length, 1);
});

test('the series is oldest-first and reflects real recorded movement', () => {
  db.metricHistory.record({ profileId, metric: 'demoMetric', day: '2026-07-01', value: 10 });
  db.metricHistory.record({ profileId, metric: 'demoMetric', day: '2026-07-03', value: 30 });
  db.metricHistory.record({ profileId, metric: 'demoMetric', day: '2026-07-02', value: 20 });

  const series = db.metricHistory.series(profileId, 'demoMetric', 30);
  assert.deepStrictEqual(series.map((p) => p.day), ['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.deepStrictEqual(series.map((p) => p.value), [10, 20, 30]);
});

test('re-recording the same day overwrites rather than appends', () => {
  db.metricHistory.record({ profileId, metric: 'overwriteMe', day: '2026-07-01', value: 5 });
  db.metricHistory.record({ profileId, metric: 'overwriteMe', day: '2026-07-01', value: 9 });
  const series = db.metricHistory.series(profileId, 'overwriteMe', 30);
  assert.strictEqual(series.length, 1);
  assert.strictEqual(series[0].value, 9);
});

test('the series is capped at the requested window, keeping the newest days', () => {
  for (let d = 1; d <= 10; d += 1) {
    db.metricHistory.record({
      profileId, metric: 'capped', day: `2026-06-${String(d).padStart(2, '0')}`, value: d,
    });
  }
  const series = db.metricHistory.series(profileId, 'capped', 3);
  assert.deepStrictEqual(series.map((p) => p.value), [8, 9, 10]);
});

test('history is per profile — one business never sees another\'s numbers', async () => {
  const reg = await post('/api/auth/register', { email: `mh2${Date.now()}@m.uz`, password: 'secret123', fullName: 'Other' });
  const otherToken = (await reg.json()).accessToken;
  const prof = await post('/api/onboarding/construct', {
    businessName: 'Other Shop', category: 'Retail Boutique / Fashion', tone: 'Playful & Fun', slogan: 'y',
  }, otherToken);
  const otherProfileId = (await prof.json()).profile.id;
  assert.notStrictEqual(otherProfileId, profileId);

  // Write the SAME metric name against the other profile at a different value.
  db.metricHistory.record({ profileId: otherProfileId, metric: 'demoMetric', day: '2026-07-01', value: 999 });

  // The first profile's series is untouched by it.
  const mine = db.metricHistory.series(profileId, 'demoMetric', 30);
  assert.deepStrictEqual(mine.map((p) => p.value), [10, 20, 30]);

  const theirs = db.metricHistory.series(otherProfileId, 'demoMetric', 30);
  assert.deepStrictEqual(theirs.map((p) => p.value), [999]);
});
