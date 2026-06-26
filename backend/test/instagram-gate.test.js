const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Keyless fallback: with no Instagram credentials, instagramEnabled must be false
// and the connect routes answer 503 "coming soon". Setting the vars to '' BEFORE
// require defines them, so dotenv won't override from any .env on disk.
const TMP_DB = path.join(os.tmpdir(), `markivo-iggate-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.INSTAGRAM_APP_ID = '';
process.env.INSTAGRAM_APP_SECRET = '';

const config = require('../config');
const { app } = require('../server');

let server, base, access;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `iggate${Date.now()}@m.uz`, password: 'secret123', fullName: 'Gate Owner' }),
  });
  access = (await reg.json()).accessToken;
});
after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('instagramEnabled is false without credentials', () => {
  assert.strictEqual(config.instagramEnabled, false);
});

test('connect answers 503 coming-soon', async () => {
  const res = await fetch(`${base}/api/instagram/connect`, { headers: { Authorization: `Bearer ${access}` } });
  assert.strictEqual(res.status, 503);
  const data = await res.json();
  assert.strictEqual(data.comingSoon, true);
});

test('status reports comingSoon, not connected', async () => {
  const res = await fetch(`${base}/api/instagram/status`, { headers: { Authorization: `Bearer ${access}` } });
  const data = await res.json();
  assert.strictEqual(data.connected, false);
  assert.strictEqual(data.comingSoon, true);
});
