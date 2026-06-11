const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-settings-test-${Date.now()}.db`);
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

const put = (p, body, token) =>
  fetch(base + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

// One user shared across the (sequential) tests below.
let token;

test('PUT /api/profile rejects missing token', async () => {
  const res = await put('/api/profile', { businessName: 'Noir Cafe' });
  assert.strictEqual(res.status, 401);
});

test('PUT /api/profile returns 404 before onboarding', async () => {
  const email = `s${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Settings Owner' })).json();
  token = reg.accessToken;

  const res = await put('/api/profile', { businessName: 'Noir Cafe' }, token);
  assert.strictEqual(res.status, 404);
});

test('PUT /api/profile updates fields and returns platforms map', async () => {
  const construct = await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { googleBusiness: true, instagram: true, telegram: true },
  }, token);
  assert.strictEqual(construct.status, 200);

  const res = await put('/api/profile', { businessName: 'Noir Coffee Lab', slogan: 'Brewed for night owls' }, token);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.profile.businessName, 'Noir Coffee Lab');
  assert.strictEqual(data.profile.slogan, 'Brewed for night owls');
  // Untouched fields survive a partial update.
  assert.strictEqual(data.profile.category, 'Cafe / Coffee Shop');
  // Platforms map must be present — the dashboard crashes without it.
  assert.ok(data.profile.platforms && typeof data.profile.platforms === 'object');
  assert.strictEqual(data.profile.platforms.instagram, true);
});

test('PUT /api/profile rejects a too-short business name', async () => {
  const res = await put('/api/profile', { businessName: 'x' }, token);
  assert.strictEqual(res.status, 400);
});

test('PUT /api/me updates preferredLang and /api/auth/me reflects it', async () => {
  const res = await put('/api/me', { preferredLang: 'ru' }, token);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.preferredLang, 'ru');

  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.strictEqual(me.status, 200);
  assert.strictEqual((await me.json()).preferredLang, 'ru');
});

test('PUT /api/me rejects an unsupported language', async () => {
  const res = await put('/api/me', { preferredLang: 'fr' }, token);
  assert.strictEqual(res.status, 400);
});
