const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
// Setting the connector credentials to '' here DEFINES them, so dotenv will not
// override from any .env on disk — this file always exercises SANDBOX mode.
const TMP_DB = path.join(os.tmpdir(), `markivo-connect-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.META_CLIENT_ID = '';
process.env.META_CLIENT_SECRET = '';
process.env.GOOGLE_CLIENT_ID = '';
process.env.GOOGLE_CLIENT_SECRET = '';

const { app } = require('../server');
const config = require('../config');

let server, base, token;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const email = `conn${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Connect Owner' })).json();
  token = reg.accessToken;
  await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { googleBusiness: true, instagram: true },
  }, token);
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
const get = (p, token) =>
  fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('connector credentials are absent, so every OAuth platform is sandbox', () => {
  assert.strictEqual(config.connectors.meta.enabled, false);
  assert.strictEqual(config.connectors.google.enabled, false);
});

test('GET /api/connect/status lists EVERY platform with connect guidance', async () => {
  const res = await get('/api/connect/status', token);
  assert.strictEqual(res.status, 200);
  const { catalogue, status } = await res.json();

  const keys = catalogue.map((c) => c.key);
  assert.deepStrictEqual(keys, ['telegram', 'meta_instagram', 'meta_facebook', 'google_business']);

  // Every entry carries what the Connections screen needs to explain itself.
  for (const c of catalogue) {
    assert.ok(c.label, `${c.key} has a label`);
    assert.ok(['oauth', 'token'].includes(c.authType), `${c.key} has an auth type`);
    assert.ok(c.howToConnect.length > 0, `${c.key} has connect steps`);
    assert.ok(c.requirements.length > 0, `${c.key} lists what you need`);
  }
  assert.strictEqual(catalogue.find((c) => c.key === 'telegram').authType, 'token');

  // Nothing is connected yet, and status covers every platform.
  assert.strictEqual(Object.keys(status).length, catalogue.length);
  assert.strictEqual(status.google_business.connected, false);
  assert.strictEqual(status.google_business.sandbox, true);
});

test('GET /api/connect/status still returns the catalogue with no profile', async () => {
  const email = `nop${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'No Profile' })).json();
  const data = await (await get('/api/connect/status', reg.accessToken)).json();
  assert.strictEqual(data.catalogue.length, 4);
  assert.deepStrictEqual(data.status, {});
});

test('POST /api/connect/:key/start connects in sandbox when keyless', async () => {
  const res = await post('/api/connect/google_business/start', {}, token);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.mode, 'sandbox');
  assert.strictEqual(data.status.connected, true);
  assert.strictEqual(data.status.sandbox, true);

  const { status } = await (await get('/api/connect/status', token)).json();
  assert.strictEqual(status.google_business.connected, true);
});

test('POST /api/connect/:key/start rejects a token-auth platform', async () => {
  const res = await post('/api/connect/telegram/start', {}, token);
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.authType, 'token');
  assert.ok(data.howToConnect.length > 0);
});

test('POST /api/connect/:key/start 404s on an unknown platform', async () => {
  assert.strictEqual((await post('/api/connect/myspace/start', {}, token)).status, 404);
});

test('the OAuth callback rejects an unsigned state without touching the DB', async () => {
  // Redirects back to the SPA with connect_error rather than leaking an error.
  const res = await fetch(`${base}/api/connect/google_business/callback?code=abc&state=forged`, { redirect: 'manual' });
  assert.strictEqual(res.status, 302);
  assert.ok(res.headers.get('location').includes('connect_error=Google'));
});

test('POST /api/connect/:key/disconnect clears the connection', async () => {
  const res = await post('/api/connect/google_business/disconnect', {}, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).status.connected, false);
});

test('/api/connect requires a session', async () => {
  assert.strictEqual((await get('/api/connect/status')).status, 401);
  assert.strictEqual((await post('/api/connect/google_business/start', {})).status, 401);
});
