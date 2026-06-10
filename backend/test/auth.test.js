const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const { app } = require('../server');

let server, base;
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

const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

test('health check responds ok', async () => {
  const res = await fetch(base + '/api/health');
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).status, 'ok');
});

test('register rejects invalid input', async () => {
  const res = await post('/api/auth/register', { email: 'bad', password: '123', fullName: '' });
  assert.strictEqual(res.status, 400);
});

test('register + login + refresh + me flow', async () => {
  const email = `u${Date.now()}@markivo.uz`;
  const reg = await post('/api/auth/register', { email, password: 'secret123', fullName: 'Test Owner' });
  assert.strictEqual(reg.status, 200);
  const regData = await reg.json();
  assert.ok(regData.accessToken && regData.refreshToken);

  // Duplicate email rejected.
  const dup = await post('/api/auth/register', { email, password: 'secret123', fullName: 'Dup' });
  assert.strictEqual(dup.status, 400);

  // Login.
  const login = await post('/api/auth/login', { email, password: 'secret123' });
  assert.strictEqual(login.status, 200);
  const loginData = await login.json();

  // /me with access token.
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${loginData.accessToken}` } });
  assert.strictEqual(me.status, 200);
  assert.strictEqual((await me.json()).email, email);

  // Refresh rotates tokens; old refresh token then rejected.
  const refresh = await post('/api/auth/refresh', { refreshToken: loginData.refreshToken });
  assert.strictEqual(refresh.status, 200);
  const refreshData = await refresh.json();
  assert.ok(refreshData.refreshToken !== loginData.refreshToken);

  const reuseOld = await post('/api/auth/refresh', { refreshToken: loginData.refreshToken });
  assert.strictEqual(reuseOld.status, 403);
});

test('protected route rejects missing token', async () => {
  const res = await fetch(base + '/api/auth/me');
  assert.strictEqual(res.status, 401);
});

test('onboarding construct returns profile with platforms map', async () => {
  const email = `o${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Owner' })).json();
  const res = await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { googleBusiness: true, instagram: true, telegram: true },
  }, reg.accessToken);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.profile.platforms.instagram, true);
});
