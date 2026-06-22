const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Keyless + isolated DB BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-prefs-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ANTHROPIC_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const { app } = require('../server');
const createDb = require('../db');
const preferences = require('../preferences');

// ---- unit: preferenceDigest ----
test('preferenceDigest is empty with no history and a match-my-style block with it', () => {
  assert.equal(preferences.preferenceDigest([]), '');
  assert.equal(preferences.preferenceDigest(undefined), '');
  const block = preferences.preferenceDigest([
    { text: 'Cardamom buns, pulled at 8am. ☕', platform: 'instagram' },
    'Second post the owner liked',
  ]);
  assert.match(block, /WHAT THIS OWNER ACTUALLY PUBLISHES/);
  assert.match(block, /Cardamom buns/);
  assert.match(block, /instagram/);
});

// ---- unit: db.feedback ----
test('db.feedback records, dedupes by text, and counts rows', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'p@m.uz', passwordHash: 'x', fullName: 'P' });
  const p = db.profiles.create({ userId: u.id, businessName: 'Prefs Cafe' });

  assert.equal(db.feedback.record({ profileId: p.id, signal: 'approved', finalText: '   ' }), null, 'blank text not stored');
  db.feedback.record({ profileId: p.id, platform: 'instagram', signal: 'approved', finalText: 'Hello world post' });
  db.feedback.record({ profileId: p.id, platform: 'instagram', signal: 'approved', finalText: 'Hello world post' }); // dup text
  db.feedback.record({ profileId: p.id, platform: 'telegram', signal: 'approved', finalText: 'A different post' });

  const ex = db.feedback.recentExamples(p.id);
  assert.equal(ex.length, 2, 'deduped to 2 distinct texts');
  assert.equal(ex[0].text, 'A different post', 'newest first');
  assert.equal(db.feedback.countByProfile(p.id), 3, 'counts all approved rows');
  db.close();
});

// ---- integration: scheduling a post is captured as a preference ----
let server, base, access;
const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });
const getJson = (p) =>
  fetch(base + p, { headers: { Authorization: `Bearer ${access}` } }).then((r) => r.json());

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `prefs${Date.now()}@m.uz`, password: 'secret123', fullName: 'Prefs Tester' }),
  });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: 'Prefs Cafe' });
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('scheduling a post is learned and surfaced via /api/preferences', async () => {
  let prefs = await getJson('/api/preferences');
  assert.equal(prefs.count, 0, 'nothing learned yet');

  const res = await post('/api/content/schedule', {
    platform: 'instagram',
    postText: 'Cardamom buns, pulled fresh at 8am sharp ☕',
    scheduledTime: new Date(Date.now() + 86400000).toISOString(),
  });
  assert.equal(res.status, 200);

  prefs = await getJson('/api/preferences');
  assert.equal(prefs.count, 1, 'one post learned');
  assert.match(prefs.examples[0].text, /Cardamom buns/);
  assert.equal(prefs.examples[0].platform, 'instagram');
});
