const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Set env BEFORE requiring the app — config caches env at load. No AI keys:
// every /api/content and /api/styles AI-Editor route below must answer 200
// with its documented keyless fallback shape rather than throwing.
const TMP_DB = path.join(os.tmpdir(), `markivo-aie-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';

const gemini = require('../gemini');
const telegramExport = require('../telegramExport');
const { app } = require('../server');

let server, base, access;
const post = (p, body, token) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) => fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await post('/api/auth/register', { email: `aie${Date.now()}@m.uz`, password: 'secret123', fullName: 'AIE Owner' });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm', slogan: 'Simplicity, refined.',
  }, access);
});
after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

// ===========================================================================
// Keyless-mode route fallbacks — must always 200, never throw
// ===========================================================================

test('POST /api/content/translate returns the original text unchanged when Gemini is unconfigured', async () => {
  const res = await post('/api/content/translate', { text: 'Fresh pastries daily!', targetLanguage: 'Spanish' }, access);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.text, 'Fresh pastries daily!');
  assert.strictEqual(body.source, 'unavailable');
});

test('POST /api/content/translate rejects empty text and a missing language', async () => {
  assert.strictEqual((await post('/api/content/translate', { text: '', targetLanguage: 'French' }, access)).status, 400);
  assert.strictEqual((await post('/api/content/translate', { text: 'hello', targetLanguage: '' }, access)).status, 400);
});

test('POST /api/content/fix applies the deterministic heuristic cleanup when Gemini is unconfigured', async () => {
  const res = await post('/api/content/fix', { text: '  hello   world!!!  come visit us today.  we are open now' }, access);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.source, 'heuristic');
  assert.strictEqual(body.text, 'Hello world! Come visit us today. We are open now');
});

test('POST /api/styles/presets lists the built-in presets without leaking their instruction text', async () => {
  const res = await get('/api/styles/presets', access);
  assert.strictEqual(res.status, 200);
  const presets = await res.json();
  assert.ok(presets.length >= 8);
  assert.ok(presets.some((p) => p.key === 'formal'));
  assert.ok(presets.every((p) => p.instruction === undefined));
  assert.ok(presets.every((p) => p.key && p.label && p.emoji));
});

test('POST /api/styles/apply with a built-in presetKey returns the text unchanged (keyless) with source "unavailable"', async () => {
  const res = await post('/api/styles/apply', { text: 'Come try our new latte.', presetKey: 'formal' }, access);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.text, 'Come try our new latte.');
  assert.strictEqual(body.source, 'unavailable');
});

test('POST /api/styles/apply rejects an unknown presetKey, and requires exactly one of presetKey/styleId', async () => {
  assert.strictEqual((await post('/api/styles/apply', { text: 'hi', presetKey: 'not_a_real_preset' }, access)).status, 400);
  assert.strictEqual((await post('/api/styles/apply', { text: 'hi' }, access)).status, 400);
  assert.strictEqual((await post('/api/styles/apply', { text: 'hi', presetKey: 'formal', styleId: 'abc' }, access)).status, 400);
});

test('POST /api/styles/apply with a styleId rejects one that does not belong to the caller', async () => {
  const res = await post('/api/styles/apply', { text: 'hi', styleId: 'not-a-real-style-id' }, access);
  assert.strictEqual(res.status, 404);
});

test('POST /api/styles/apply with an owned styleId works, using the saved styleSummary as the instruction', async () => {
  const saved = await (await post('/api/styles', {
    name: 'Playful & emoji-heavy',
    sampleText: 'Yo! Cookies are HOT 🔥🔥 come get em',
    styleSummary: 'Playful, high-energy, emoji-heavy.',
    source: 'manual',
  }, access)).json();

  const res = await post('/api/styles/apply', { text: 'New menu today.', styleId: saved.id }, access);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.text, 'New menu today.'); // keyless -> unchanged
  assert.strictEqual(body.source, 'unavailable');
});

// ===========================================================================
// /api/styles/import — Telegram export parsing (pure parsing, no AI budget)
// ===========================================================================

test('POST /api/styles/import extracts a sample from a Telegram JSON export', async () => {
  const content = JSON.stringify({
    messages: [
      { id: 1, type: 'message', text: 'Short one' },
      { id: 2, type: 'message', text: [{ type: 'bold', text: 'Big sale ' }, 'this weekend only, come by the shop for fresh bread and pastries!'] },
      { id: 3, type: 'service', text: '' },
    ],
  });
  const res = await post('/api/styles/import', { format: 'json', content }, access);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.sample.includes('Big sale this weekend only'));
  assert.strictEqual(body.messageCount, 3);
});

test('POST /api/styles/import extracts a sample from a Telegram HTML export', async () => {
  const content = `
    <div class="message default clearfix">
      <div class="body">
        <div class="text">Come visit our <b>new</b> flagship store this Friday for the grand opening!</div>
      </div>
    </div>`;
  const res = await post('/api/styles/import', { format: 'html', content }, access);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.sample.includes('Come visit our new flagship store'));
});

test('POST /api/styles/import 400s on an unreadable file', async () => {
  const res = await post('/api/styles/import', { format: 'json', content: 'not json at all' }, access);
  assert.strictEqual(res.status, 400);
});

test('POST /api/styles/import 400s on an unsupported format', async () => {
  const res = await post('/api/styles/import', { format: 'pdf', content: 'x' }, access);
  assert.strictEqual(res.status, 400);
});

// ===========================================================================
// Pure functions — no server needed
// ===========================================================================

test('gemini.heuristicFix collapses whitespace, repeated punctuation, and capitalizes sentence starts', () => {
  assert.strictEqual(gemini.heuristicFix('  hi   there!!!  how are you?  good.  '), 'Hi there! How are you? Good.');
});

test('telegramExport.parseTelegramExport throws a clear error on empty messages', () => {
  assert.throws(() => telegramExport.parseTelegramExport({ format: 'json', content: JSON.stringify({ messages: [] }) }));
});
