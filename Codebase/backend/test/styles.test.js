const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
// GEMINI_API_KEY='' defined here means dotenv cannot override it from a .env on
// disk, so this file always exercises the KEYLESS (heuristic) path.
const TMP_DB = path.join(os.tmpdir(), `markivo-styles-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';

const { app } = require('../server');
const gemini = require('../gemini');
const ai = require('../ai');

// One user + profile shared across the (sequential) tests below.
let server, base, token, styleId;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const email = `style${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Style Owner' })).json();
  token = reg.accessToken;
  await post('/api/onboarding/construct', {
    businessName: 'Yunusobod Arena', category: 'Local Restaurant / Food', tone: 'Energetic & Fast-paced',
    platforms: { googleBusiness: true, instagram: true, telegram: true },
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
const put = (p, body, token) =>
  fetch(base + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) =>
  fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const del = (p, token) =>
  fetch(base + p, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });

// --- pure module: the deterministic heuristic style reader -------------------

test('heuristicStyle describes HOW a sample is written, not what it says', () => {
  const out = gemini.heuristicStyle('Fresh bread daily!! 🥖✨ Come get yours before noon. Trust us, it sells out fast!!');
  assert.strictEqual(out.source, 'heuristic');
  assert.ok(out.name.length > 0);
  assert.match(out.styleSummary, /emoji/i);
  assert.match(out.styleSummary, /exclamation/i);
  // Never leaks the sample's own subject matter (bread/noon) into the summary.
  assert.ok(!/bread|noon/i.test(out.styleSummary));
});

test('heuristicStyle honestly reports plain, unadorned text', () => {
  const out = gemini.heuristicStyle('We are open today. Come visit us this afternoon for lunch.');
  assert.match(out.styleSummary, /no emoji/i);
  assert.match(out.styleSummary, /no hashtags/i);
});

// --- HTTP surface -------------------------------------------------------------

test('POST /api/styles/analyze returns a draft without saving it', async () => {
  const res = await post('/api/styles/analyze', { sample: 'POV: you found the best lagman in town 🍜🔥 tag a friend who needs this!!' }, token);
  assert.strictEqual(res.status, 200);
  const draft = await res.json();
  assert.ok(draft.styleSummary.length > 0);
  assert.strictEqual(draft.source, 'heuristic');
  assert.strictEqual(draft.sampleText, 'POV: you found the best lagman in town 🍜🔥 tag a friend who needs this!!');

  // Draft only — nothing persisted yet.
  const list = await (await get('/api/styles', token)).json();
  assert.strictEqual(list.length, 0);
});

test('POST /api/styles/analyze rejects an empty sample', async () => {
  const res = await post('/api/styles/analyze', { sample: '   ' }, token);
  assert.strictEqual(res.status, 400);
});

test('POST /api/styles saves a named voice profile', async () => {
  const res = await post('/api/styles', {
    name: 'Playful & emoji-heavy',
    sampleText: 'POV: you found the best lagman in town 🍜🔥',
    styleSummary: 'Voice: very short sentences; heavy emoji use; uses exclamation marks; no hashtags.',
    source: 'heuristic',
  }, token);
  assert.strictEqual(res.status, 200);
  const saved = await res.json();
  styleId = saved.id;
  assert.strictEqual(saved.name, 'Playful & emoji-heavy');
  assert.match(saved.styleSummary, /heavy emoji use/);
});

test('POST /api/styles rejects a blank style summary', async () => {
  const res = await post('/api/styles', { name: 'Empty', styleSummary: '   ' }, token);
  assert.strictEqual(res.status, 400);
});

test('GET /api/styles lists saved styles, newest first', async () => {
  await post('/api/styles', { name: 'Formal & clean', styleSummary: 'Voice: longer sentences; no emoji; no hashtags.' }, token);
  const list = await (await get('/api/styles', token)).json();
  assert.strictEqual(list.length, 2);
  assert.strictEqual(list[0].name, 'Formal & clean'); // most recent first
});

test('PUT /api/styles/:id updates the name and summary', async () => {
  const res = await put(`/api/styles/${styleId}`, { name: 'Playful (renamed)' }, token);
  assert.strictEqual(res.status, 200);
  const updated = await res.json();
  assert.strictEqual(updated.name, 'Playful (renamed)');
  assert.match(updated.styleSummary, /heavy emoji use/); // untouched field survives
});

test('styles are scoped to the owning profile', async () => {
  const email = `other${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Other Owner' })).json();
  await post('/api/onboarding/construct', {
    businessName: 'Other Spot', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { instagram: true },
  }, reg.accessToken);

  assert.strictEqual((await (await get('/api/styles', reg.accessToken)).json()).length, 0);
  assert.strictEqual((await put(`/api/styles/${styleId}`, { name: 'stolen' }, reg.accessToken)).status, 404);
  assert.strictEqual((await del(`/api/styles/${styleId}`, reg.accessToken)).status, 404);
});

test('POST /api/content/copywrite with a styleId silently ignores one that does not belong to the caller', async () => {
  const email = `other2${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Other Owner 2' })).json();
  await post('/api/onboarding/construct', {
    businessName: 'Other Spot 2', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { instagram: true },
  }, reg.accessToken);

  // styleId belongs to `token`'s profile, not this one — must not 404/500.
  const res = await post('/api/content/copywrite', { platform: 'instagram', topic: 'weekend special', styleId }, reg.accessToken);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(typeof body.post === 'string' && body.post.length > 0);
});

test('DELETE /api/styles/:id removes it', async () => {
  assert.strictEqual((await del(`/api/styles/${styleId}`, token)).status, 200);
  const list = await (await get('/api/styles', token)).json();
  assert.strictEqual(list.length, 1);
});

// --- generateContent style injection (keyless template path is unaffected;
// this verifies the styleSummary plumbing reaches the pipeline without
// throwing when a live engine is unavailable) --------------------------------

test('ai.generateContent accepts ctx.styleSummary and still falls back cleanly when keyless', async () => {
  const result = await ai.generateContent({
    platform: 'instagram',
    topic: 'weekend special',
    businessName: 'Yunusobod Arena',
    styleSummary: 'Voice: very short sentences; heavy emoji use.',
  });
  assert.ok(typeof result.post === 'string' && result.post.length > 0);
});
