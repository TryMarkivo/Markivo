const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// Tiny freemium limit so enforcement is cheap to reach.
const TMP_DB = path.join(os.tmpdir(), `markivo-usage-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AI_LIMIT_FREEMIUM = '3';

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

test('usage starts at zero with the tier limit applied', async () => {
  const u = await getUsage();
  assert.strictEqual(u.tier, 'freemium');
  assert.strictEqual(u.used, 0);
  assert.strictEqual(u.limit, 3);
  assert.strictEqual(u.remaining, 3);
  assert.match(u.resetsAt, /^\d{4}-\d{2}-01T00:00:00/);
});

test('each generation kind draws from the shared monthly allowance', async () => {
  assert.strictEqual((await post('/api/onboarding/slogans', { businessName: 'Usage Cafe' })).status, 200);
  assert.strictEqual((await post('/api/content/copywrite', { platform: 'instagram', topic: 'tea' })).status, 200);
  assert.strictEqual((await post('/api/agent/query', { query: 'How are my metrics?' })).status, 200);

  const u = await getUsage();
  assert.strictEqual(u.used, 3);
  assert.strictEqual(u.remaining, 0);
});

test('the generation after the limit is rejected with a friendly 429', async () => {
  const res = await post('/api/content/copywrite', { platform: 'instagram', topic: 'more tea' });
  assert.strictEqual(res.status, 429);
  const data = await res.json();
  assert.match(data.error, /used all 3 AI generations/i);
  assert.strictEqual(data.usage.used, 3);

  const u = await getUsage();
  assert.strictEqual(u.used, 3, 'a rejected request must not consume allowance');
});

test('countThisMonth ignores usage from previous months', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'm@b.com', passwordHash: 'h', fullName: 'M' });
  db.usage.record({ userId: u.id, kind: 'content' });
  // Backdate a row into a previous month directly.
  db._raw.prepare('INSERT INTO ai_usage (id, user_id, kind, created_at) VALUES (?, ?, ?, ?)')
    .run('old1', u.id, 'content', '2020-01-15T10:00:00.000Z');
  assert.strictEqual(db.usage.countThisMonth(u.id), 1);
  db.close();
});
