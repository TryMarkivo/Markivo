const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// TELEGRAM_ENABLED is deliberately NOT set: this suite asserts the default
// de-scoped (coming-soon) behavior of the Telegram feature flag.
const TMP_DB = path.join(os.tmpdir(), `markivo-tggate-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
// Explicit 'false' (not delete): dotenv loads backend/.env at require time but
// never overrides existing env — this pins the flag OFF for this suite.
process.env.TELEGRAM_ENABLED = 'false';

const { app } = require('../server');

let server, base, access;

const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await post('/api/auth/register', { email: `gate${Date.now()}@m.uz`, password: 'secret123', fullName: 'Gate Tester' });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: 'Gate Cafe' }, access);
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('telegram status reports comingSoon when the flag is off', async () => {
  const res = await fetch(`${base}/api/telegram/status`, { headers: { Authorization: `Bearer ${access}` } });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.deepStrictEqual(data, { connected: false, comingSoon: true });
});

test('mutating telegram routes answer 503 coming-soon when the flag is off', async () => {
  for (const [route, body] of [
    ['/api/telegram/connect', { botToken: '1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['/api/telegram/detect-chat', {}],
    ['/api/telegram/channel', { chat: '@somewhere' }],
    ['/api/telegram/post', { text: 'hello' }],
  ]) {
    const res = await post(route, body, access);
    assert.strictEqual(res.status, 503, `${route} should be gated`);
    const data = await res.json();
    assert.strictEqual(data.comingSoon, true, `${route} should flag comingSoon`);
  }
});

test('agent telegram_post requests get a coming-soon reply instead of an approval', async () => {
  const res = await post('/api/agent/query', { query: 'Post our weekend offer to Telegram' }, access);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(!data.triggerApproval, 'must not open an approval dialog while de-scoped');
  assert.match(data.reply || '', /coming soon/i);
});
