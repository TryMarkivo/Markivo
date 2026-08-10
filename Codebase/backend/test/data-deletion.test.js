const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Isolate the test DB + secrets BEFORE requiring the app (config reads env at
// load). A real META_CLIENT_SECRET is set here so the data-deletion callback is
// configured and its signature verification is genuinely exercised.
const TMP_DB = path.join(os.tmpdir(), `markivo-deletion-test-${Date.now()}.db`);
const APP_SECRET = 'meta_app_secret_for_tests';
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.META_CLIENT_ID = 'meta_client_id';
process.env.META_CLIENT_SECRET = APP_SECRET;
process.env.INSTAGRAM_APP_ID = '';
process.env.INSTAGRAM_APP_SECRET = '';
process.env.APP_URL = 'https://trymarkivo.com';

const { app } = require('../server');
const createDb = require('../db');
const metaDeletion = require('../metaDeletion');

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
const get = (p, token) =>
  fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const del = (p, token) =>
  fetch(base + p, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });

// Register a user and walk them through onboarding so there is cascading data.
async function makeUser(label) {
  const email = `${label}${Date.now()}${Math.random().toString(16).slice(2)}@markivo.uz`;
  const reg = await (await post('/api/auth/register', {
    email, password: 'secret123', fullName: 'Deletion Owner',
  })).json();
  await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { instagram: true },
  }, reg.accessToken);
  return { email, token: reg.accessToken, refreshToken: reg.refreshToken };
}

// Build a signed_request exactly the way Meta does: base64url(HMAC-SHA256 over
// the ENCODED payload) + '.' + base64url(payload JSON).
function signRequest(payload, secret) {
  const b64url = (buf) =>
    Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const encodedPayload = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(encodedPayload).digest();
  return `${b64url(sig)}.${encodedPayload}`;
}

const postForm = (p, form) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });

// --- signed_request parsing -------------------------------------------------

test('a correctly signed request decodes to its payload', () => {
  const signed = signRequest({ user_id: '12345', algorithm: 'HMAC-SHA256' }, APP_SECRET);
  const payload = metaDeletion.parseSignedRequest(signed, APP_SECRET);
  assert.strictEqual(payload.user_id, '12345');
});

test('a request signed with the wrong secret is rejected', () => {
  const signed = signRequest({ user_id: '12345' }, 'not_the_app_secret');
  assert.throws(
    () => metaDeletion.parseSignedRequest(signed, APP_SECRET),
    /signature does not verify/
  );
});

test('a tampered payload is rejected even though the signature is well-formed', () => {
  const signed = signRequest({ user_id: '12345' }, APP_SECRET);
  const [sig] = signed.split('.');
  const forged = Buffer.from(JSON.stringify({ user_id: '99999' })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.throws(() => metaDeletion.parseSignedRequest(`${sig}.${forged}`, APP_SECRET), /does not verify/);
});

test('malformed and missing signed_requests are rejected, not crashed on', () => {
  assert.throws(() => metaDeletion.parseSignedRequest('', APP_SECRET), /missing/);
  assert.throws(() => metaDeletion.parseSignedRequest('no-dot-here', APP_SECRET), /malformed/);
  assert.throws(() => metaDeletion.parseSignedRequest('a.b.c', APP_SECRET), /malformed/);
  assert.throws(() => metaDeletion.parseSignedRequest('AAAA.!!!notjson', APP_SECRET), /not valid JSON/);
});

test('a non-HMAC-SHA256 algorithm claim is refused', () => {
  const signed = signRequest({ user_id: '1', algorithm: 'PLAINTEXT' }, APP_SECRET);
  assert.throws(() => metaDeletion.parseSignedRequest(signed, APP_SECRET), /unsupported algorithm/);
});

// --- self-serve account deletion -------------------------------------------

test('DELETE /api/me erases the account and every cascading row', async () => {
  const user = await makeUser('selfserve');

  const res = await del('/api/me', user.token);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.success, true);
  assert.match(body.confirmationCode, /^[0-9a-f]{16}$/);
  assert.strictEqual(body.statusUrl, `https://trymarkivo.com/data-deletion.html?code=${body.confirmationCode}`);

  // The user is gone from the data layer, and so is the profile that cascaded.
  const db = createDb(TMP_DB);
  assert.strictEqual(db.users.findByEmail(user.email), undefined);

  // The refresh token no longer works — the session cannot be revived.
  const refreshed = await post('/api/auth/refresh', { refreshToken: user.refreshToken });
  assert.strictEqual(refreshed.status, 403);
});

test('the deleted account\'s access token can no longer reach the API', async () => {
  const user = await makeUser('revoked');
  await del('/api/me', user.token);
  // The JWT is still cryptographically valid until it expires, so routes must
  // fail on the missing user rather than on the signature.
  const res = await get('/api/auth/me', user.token);
  assert.strictEqual(res.status, 404);
});

// --- Meta callback ----------------------------------------------------------

test('the callback erases the account linked to the Meta user id', async () => {
  const user = await makeUser('metalinked');
  const db = createDb(TMP_DB);
  const dbUser = db.users.findByEmail(user.email);
  const profile = db.profiles.findByUserId(dbUser.id);

  // Simulate a completed Meta connect: metaUserId is what the callback matches.
  db.connections.upsert({
    profileId: profile.id,
    platform: 'meta_facebook',
    status: 'connected',
    accountHandle: 'Noir Cafe Page',
    accountId: 'page_555',
    accessToken: 'page-token',
    meta: { pageId: 'page_555', metaUserId: 'meta_user_777' },
  });

  const signed = signRequest({ user_id: 'meta_user_777', algorithm: 'HMAC-SHA256' }, APP_SECRET);
  const res = await postForm('/api/meta/data-deletion', { signed_request: signed });
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  // Meta requires exactly these two fields.
  assert.ok(body.confirmation_code, 'confirmation_code is required by Meta');
  assert.strictEqual(body.url, `https://trymarkivo.com/data-deletion.html?code=${body.confirmation_code}`);

  const after = createDb(TMP_DB);
  assert.strictEqual(after.users.findByEmail(user.email), undefined);

  const status = await (await get(`/api/data-deletion/status?code=${body.confirmation_code}`)).json();
  assert.strictEqual(status.status, 'completed');
});

test('an unknown Meta user id still returns a trackable code, marked no_match', async () => {
  const signed = signRequest({ user_id: 'nobody_here_9999' }, APP_SECRET);
  const res = await postForm('/api/meta/data-deletion', { signed_request: signed });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.confirmation_code);

  const status = await (await get(`/api/data-deletion/status?code=${body.confirmation_code}`)).json();
  assert.strictEqual(status.status, 'no_match');
});

test('the callback rejects a badly signed request without erasing anything', async () => {
  const user = await makeUser('untouched');
  const signed = signRequest({ user_id: 'meta_user_777' }, 'wrong_secret');
  const res = await postForm('/api/meta/data-deletion', { signed_request: signed });
  assert.strictEqual(res.status, 400);
  // The rejection reason is not leaked to the caller.
  assert.strictEqual((await res.json()).error, 'Invalid signed_request');

  const db = createDb(TMP_DB);
  assert.ok(db.users.findByEmail(user.email), 'an unverified callback must not delete anything');
});

test('the status endpoint refuses a missing or unknown code', async () => {
  assert.strictEqual((await get('/api/data-deletion/status')).status, 400);
  assert.strictEqual((await get('/api/data-deletion/status?code=deadbeefdeadbeef')).status, 404);
});

test('a deletion record outlives the account it erased', async () => {
  const user = await makeUser('outlives');
  const body = await (await del('/api/me', user.token)).json();
  // The user row is gone, but the confirmation code still resolves — this is why
  // deletion_requests deliberately has no foreign key to users(id).
  const status = await (await get(`/api/data-deletion/status?code=${body.confirmationCode}`)).json();
  assert.strictEqual(status.status, 'completed');
  assert.ok(status.requestedAt);
});
