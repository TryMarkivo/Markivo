const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// Tiny writing limit so enforcement is cheap to reach; image/video are left at
// their defaults so the bucket-isolation test has something to spend. Keyless
// on BOTH text engines so counting is deterministic and never burns a live
// model's rate limit.
const TMP_DB = path.join(os.tmpdir(), `markivo-usage-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AI_LIMIT_FREEMIUM_WRITING = '3';
process.env.AI_LIMIT_FREEMIUM_IMAGE = '2';

const { app } = require('../server');
const createDb = require('../db');

let server, base, access;

const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });

const getUsage = async () =>
  (await fetch(`${base}/api/usage`, { headers: { Authorization: `Bearer ${access}` } })).json();

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `use${Date.now()}@m.uz`, password: 'secret123', fullName: 'U' }),
  });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: 'Usage Cafe' });
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('usage starts at zero, per bucket, resetting on a Monday', async () => {
  const u = await getUsage();
  assert.strictEqual(u.tier, 'freemium');
  assert.deepStrictEqual(Object.keys(u.buckets), ['writing', 'image', 'video']);
  assert.deepStrictEqual(u.buckets.writing, { used: 0, limit: 3, remaining: 3 });
  assert.deepStrictEqual(u.buckets.image, { used: 0, limit: 2, remaining: 2 });
  // Freemium ships with no video at all — that is the upgrade lever.
  assert.deepStrictEqual(u.buckets.video, { used: 0, limit: 0, remaining: 0 });
  assert.strictEqual(new Date(u.resetsAt).getUTCDay(), 1, 'the allowance resets on a Monday');
  assert.match(u.resetsAt, /T00:00:00/);
});

test('every text generation draws from the shared writing bucket', async () => {
  assert.strictEqual((await post('/api/onboarding/slogans', { businessName: 'Usage Cafe' })).status, 200);
  assert.strictEqual((await post('/api/content/copywrite', { platform: 'instagram', topic: 'tea' })).status, 200);
  assert.strictEqual((await post('/api/agent/query', { query: 'How are my metrics?' })).status, 200);

  const u = await getUsage();
  assert.strictEqual(u.buckets.writing.used, 3);
  assert.strictEqual(u.buckets.writing.remaining, 0);
});

test('the generation after the limit is rejected with a friendly 429', async () => {
  const res = await post('/api/content/copywrite', { platform: 'instagram', topic: 'more tea' });
  assert.strictEqual(res.status, 429);
  const data = await res.json();
  assert.match(data.error, /used all 3 writing generations/i);
  assert.match(data.error, /this week/i);
  assert.strictEqual(data.bucket, 'writing');
  assert.strictEqual(data.usage.buckets.writing.used, 3);

  const u = await getUsage();
  assert.strictEqual(u.buckets.writing.used, 3, 'a rejected request must not consume allowance');
});

test('exhausting one bucket leaves the others untouched', async () => {
  // writing is spent (above), but the image allowance is a separate pool — this
  // is the whole point of the split, so it is worth pinning directly.
  const u = await getUsage();
  assert.strictEqual(u.buckets.writing.remaining, 0);
  assert.strictEqual(u.buckets.image.remaining, 2);
});

test('countThisWeek is scoped to both the bucket and the current week', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'm@b.com', passwordHash: 'h', fullName: 'M' });

  db.usage.record({ userId: u.id, kind: 'content', bucket: 'writing' });
  db.usage.record({ userId: u.id, kind: 'media_image', bucket: 'image' });
  // Backdate a row well before this week.
  db._raw.prepare('INSERT INTO ai_usage (id, user_id, kind, bucket, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('old1', u.id, 'content', 'writing', '2020-01-15T10:00:00.000Z');

  assert.strictEqual(db.usage.countThisWeek(u.id, 'writing'), 1, 'last week does not count');
  assert.strictEqual(db.usage.countThisWeek(u.id, 'image'), 1, 'buckets are counted separately');
  assert.strictEqual(db.usage.countThisWeek(u.id, 'video'), 0);
  db.close();
});

test('the week boundary is the preceding Monday at 00:00 UTC', () => {
  const db = createDb(':memory:');
  // A Wednesday, a Monday, and a Sunday — Sunday belongs to the week that
  // STARTED on the Monday before it, which is the case an off-by-one breaks.
  assert.strictEqual(db.weekStartIso(new Date('2026-08-12T15:00:00Z')), '2026-08-10T00:00:00.000Z');
  assert.strictEqual(db.weekStartIso(new Date('2026-08-10T00:00:00Z')), '2026-08-10T00:00:00.000Z');
  assert.strictEqual(db.weekStartIso(new Date('2026-08-16T23:59:59Z')), '2026-08-10T00:00:00.000Z');
  assert.strictEqual(db.weekEndIso(new Date('2026-08-12T15:00:00Z')), '2026-08-17T00:00:00.000Z');
  db.close();
});

test('a refund returns exactly one unit to its own bucket', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'r@b.com', passwordHash: 'h', fullName: 'R' });
  db.usage.record({ userId: u.id, kind: 'media_video', bucket: 'video' });
  db.usage.record({ userId: u.id, kind: 'media_video', bucket: 'video' });
  db.usage.record({ userId: u.id, kind: 'content', bucket: 'writing' });

  assert.strictEqual(db.usage.refundLatest({ userId: u.id, bucket: 'video' }), true);
  assert.strictEqual(db.usage.countThisWeek(u.id, 'video'), 1);
  assert.strictEqual(db.usage.countThisWeek(u.id, 'writing'), 1, 'a video refund must not touch writing');

  db.usage.refundLatest({ userId: u.id, bucket: 'video' });
  assert.strictEqual(db.usage.refundLatest({ userId: u.id, bucket: 'video' }), false, 'nothing left to refund');
  assert.strictEqual(db.usage.countThisWeek(u.id, 'video'), 0);
  db.close();
});
