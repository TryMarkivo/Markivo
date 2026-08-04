const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
// GEMINI_API_KEY='' defined here means dotenv cannot override it from a .env on
// disk, so this file always exercises the KEYLESS (heuristic) path.
const TMP_DB = path.join(os.tmpdir(), `markivo-templates-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = '';

const { app } = require('../server');
const gemini = require('../gemini');

// One user + profile shared across the (sequential) tests below.
let server, base, token, templateId;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const email = `tpl${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Template Owner' })).json();
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

// --- pure module: the deterministic parser + renderer -----------------------

test('heuristic parser turns the numbers in a real message into variables', () => {
  const out = gemini.heuristicTemplate('Stadium No:141, 9 spots left✅');
  // Both numbers become placeholders, named from the words around them.
  assert.deepStrictEqual(gemini.extractVariables(out.templateText), ['stadium_no', 'spots_left']);
  assert.strictEqual(out.templateText, 'Stadium No:{{stadium_no}}, {{spots_left}} spots left✅');
  // The fixed wording and the emoji survive untouched.
  assert.ok(out.templateText.includes('spots left✅'));
  assert.strictEqual(out.variables[0].example, '141');
  assert.strictEqual(out.variables[1].example, '9');
  assert.strictEqual(out.source, 'heuristic');
});

test('heuristic parser never collides two variables on one key', () => {
  const out = gemini.heuristicTemplate('Court No:3 and Court No:7');
  const keys = gemini.extractVariables(out.templateText);
  assert.strictEqual(keys.length, 2);
  assert.strictEqual(new Set(keys).size, 2);
});

test('a message with nothing variable yields a template with no variables', () => {
  const out = gemini.heuristicTemplate('We are open today!');
  assert.strictEqual(out.templateText, 'We are open today!');
  assert.deepStrictEqual(out.variables, []);
});

test('renderTemplate fills values and blanks the rest', () => {
  const tpl = 'Stadium No:{{stadium_no}}, {{spots_left}} spots left';
  assert.strictEqual(gemini.renderTemplate(tpl, { stadium_no: '141', spots_left: '9' }), 'Stadium No:141, 9 spots left');
  assert.strictEqual(gemini.renderTemplate(tpl, { stadium_no: '7' }), 'Stadium No:7, ____ spots left');
  assert.strictEqual(gemini.blankPreview(tpl), 'Stadium No:____, ____ spots left');
});

test('reconcileVariables follows the template text, not the supplied list', () => {
  // A variable the owner REMOVED from the text is dropped...
  const dropped = gemini.reconcileVariables('Hi {{name}}', [{ key: 'name' }, { key: 'gone' }]);
  assert.deepStrictEqual(dropped.map((v) => v.key), ['name']);
  // ...and one they ADDED by hand is picked up with a readable default label.
  const added = gemini.reconcileVariables('Hi {{name}}, table {{table_no}}', [{ key: 'name', label: 'Guest' }]);
  assert.deepStrictEqual(added.map((v) => v.key), ['name', 'table_no']);
  assert.strictEqual(added[0].label, 'Guest');
  assert.strictEqual(added[1].label, 'Table no');
});

// --- HTTP surface -----------------------------------------------------------

test('GET /api/templates/engine reports the keyless engine', async () => {
  const data = await (await get('/api/templates/engine', token)).json();
  assert.strictEqual(data.gemini, false);
  assert.strictEqual(data.model, null);
});

test('POST /api/templates/analyze returns a draft without saving it', async () => {
  const res = await post('/api/templates/analyze', { sample: 'Stadium No:141, 9 spots left✅', platform: 'instagram' }, token);
  assert.strictEqual(res.status, 200);
  const draft = await res.json();
  assert.strictEqual(draft.templateText, 'Stadium No:{{stadium_no}}, {{spots_left}} spots left✅');
  assert.strictEqual(draft.variables.length, 2);
  assert.strictEqual(draft.preview, 'Stadium No:____, ____ spots left✅');

  // Draft only — nothing persisted yet.
  const list = await (await get('/api/templates', token)).json();
  assert.strictEqual(list.length, 0);
});

test('POST /api/templates/analyze rejects an empty message', async () => {
  const res = await post('/api/templates/analyze', { sample: '   ' }, token);
  assert.strictEqual(res.status, 400);
});

test('POST /api/templates saves a template scoped to a platform', async () => {
  const res = await post('/api/templates', {
    platform: 'instagram',
    name: 'Spots left',
    sampleText: 'Stadium No:141, 9 spots left✅',
    templateText: 'Stadium No:{{stadium_no}}, {{spots_left}} spots left✅',
    variables: [{ key: 'stadium_no', label: 'Stadium number', example: '141' }],
    source: 'heuristic',
  }, token);
  assert.strictEqual(res.status, 200);
  const saved = await res.json();
  templateId = saved.id;
  assert.strictEqual(saved.platform, 'instagram');
  assert.strictEqual(saved.name, 'Spots left');
  // The text is authoritative: spots_left had no entry in the list but is in
  // the text, so it comes back as a variable anyway.
  assert.deepStrictEqual(saved.variables.map((v) => v.key), ['stadium_no', 'spots_left']);
  assert.strictEqual(saved.variables[0].label, 'Stadium number');
});

test('GET /api/templates filters by platform', async () => {
  await post('/api/templates', { platform: 'telegram', name: 'TG', templateText: 'Bugun {{soat}} da ochiq' }, token);
  const all = await (await get('/api/templates', token)).json();
  assert.strictEqual(all.length, 2);
  const igOnly = await (await get('/api/templates?platform=instagram', token)).json();
  assert.strictEqual(igOnly.length, 1);
  assert.strictEqual(igOnly[0].platform, 'instagram');
});

test('PUT /api/templates/:id honours a hand-removed variable', async () => {
  const res = await put(`/api/templates/${templateId}`, {
    templateText: 'Stadium No:{{stadium_no}}, spots left✅',
  }, token);
  assert.strictEqual(res.status, 200);
  const updated = await res.json();
  assert.deepStrictEqual(updated.variables.map((v) => v.key), ['stadium_no']);
});

test('POST /api/templates/:id/render fills the saved template', async () => {
  const res = await post(`/api/templates/${templateId}/render`, { values: { stadium_no: '7' } }, token);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).text, 'Stadium No:7, spots left✅');
});

test('templates are scoped to the owning profile', async () => {
  const email = `other${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Other Owner' })).json();
  await post('/api/onboarding/construct', {
    businessName: 'Other Spot', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
    platforms: { instagram: true },
  }, reg.accessToken);

  assert.strictEqual((await (await get('/api/templates', reg.accessToken)).json()).length, 0);
  // Another business cannot read, edit, render, or delete this template.
  assert.strictEqual((await put(`/api/templates/${templateId}`, { name: 'stolen' }, reg.accessToken)).status, 404);
  assert.strictEqual((await post(`/api/templates/${templateId}/render`, { values: {} }, reg.accessToken)).status, 404);
  assert.strictEqual((await del(`/api/templates/${templateId}`, reg.accessToken)).status, 404);
});

test('DELETE /api/templates/:id removes it', async () => {
  assert.strictEqual((await del(`/api/templates/${templateId}`, token)).status, 200);
  const list = await (await get('/api/templates?platform=instagram', token)).json();
  assert.strictEqual(list.length, 0);
});
