const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Generated copy must read like a person wrote it. The voice rules ride on
// every copy prompt, and a draft that still shows a machine-writing habit gets
// one rewrite with the habits named. Set env BEFORE requiring the app.
const TMP_DB = path.join(os.tmpdir(), `markivo-voice-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = 'fake_test_key_123';
process.env.GEMINI_FALLBACK_MODEL = '';

const realFetch = global.fetch;
let onGemini = null;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, opts);
  const answer = onGemini && onGemini(JSON.parse(opts.body));
  if (!answer) throw new TypeError('fetch failed');
  return { ok: true, status: 200, json: async () => answer };
};
const completed = (obj) => ({
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(obj) }] }],
});

const humanVoice = require('../marketing/humanVoice');
const ai = require('../ai');

after(() => {
  onGemini = null;
  global.fetch = realFetch;
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) fs.rmSync(f, { force: true });
});

test('the classic machine-writing habits are caught, in English, Russian and Uzbek', () => {
  assert.ok(humanVoice.aiTells("Not just coffee — it's a ritual.").length);
  assert.ok(humanVoice.aiTells("Whether you're studying or working, we're here.").length);
  assert.ok(humanVoice.aiTells('Indulge in our latte.').length);
  assert.ok(humanVoice.aiTells('Craving something sweet?\nTry the honey cake.').length);
  assert.ok(humanVoice.aiTells('**New** honey cake').length);
  assert.ok(humanVoice.aiTells('☕️ Latte\n🍰 Cake\n📍 Mirobod').length, 'an emoji list');
  assert.ok(humanVoice.aiTells('Медовик идеально сочетается с кофе.').length);
  assert.ok(humanVoice.aiTells('Espresso va ziravorlar uyg‘unligida tayyorlanadi.').length, 'any apostrophe form');
});

test('plain, specific copy passes untouched — including normal dashes, prices and one 📍 line', () => {
  for (const text of [
    "Iced filter coffee is back. Add a slice of honey cake for 28,000 sum — baked every morning by the owner's mother.",
    'Кусочек стоит 28 000 сумов — лучше всего к фильтр-кофе. Работаем с 8:00–22:00.',
    "Kardamonli latte — 32 000 so'm.\n\n📍 Mirobod tumani, Amir Temur xiyoboni yaqinida.",
  ]) assert.deepStrictEqual(humanVoice.aiTells(text), [], text);
});

test('a draft with machine habits gets one rewrite that names them; a clean draft costs no second call', async () => {
  const calls = [];
  onGemini = (body) => {
    calls.push(body);
    if (/IT STILL READS MACHINE-WRITTEN/.test(String(body.input))) {
      return completed({ post: 'Honey cake, baked this morning by the owner\'s mother. 28,000 sum a slice.', mediaTip: 'Shoot it by the window.', hashtags: ['#noirkafe'] });
    }
    return completed({ post: '✨ Indulge in our honey cake!\n☕️ Latte\n🍰 Cake\n📍 Mirobod', mediaTip: 'x', hashtags: ['#noirkafe'] });
  };
  const out = await ai.generateContent({ platform: 'instagram', topic: 'honey cake', languages: ['en'], memory: 'Noir Kafe. Honey cake 28,000 sum, baked by the owner\'s mother.' });
  assert.strictEqual(calls.length, 2, 'the draft, then one rewrite');
  assert.match(calls[0].system_instruction, /HUMAN VOICE/, 'the voice rules ride on the copy prompt');
  assert.match(calls[1].input, /BUSINESS MEMORY:\nNoir Kafe/, 'the rewrite keeps the real facts in view');
  assert.match(out.post, /^Honey cake, baked this morning/);

  calls.length = 0;
  onGemini = (body) => {
    calls.push(body);
    return completed({ post: 'Honey cake, baked every morning. 28,000 sum a slice.', mediaTip: 'x', hashtags: [] });
  };
  await ai.generateContent({ platform: 'instagram', topic: 'honey cake', languages: ['en'], memory: 'Noir Kafe.' });
  assert.strictEqual(calls.length, 1, 'clean copy is not rewritten');
});

test('Markiv talks like a colleague, and its drafts follow the same voice', () => {
  assert.match(humanVoice.CHAT_VOICE, /Lead with the answer/);
  assert.match(humanVoice.CHAT_VOICE, /I hope this helps/);
});
