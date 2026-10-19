const { test, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Saved briefs, edit plans and competitor insights follow the owner when they
// switch the UI language: translated once per language, kept on the record.
const TMP_DB = path.join(os.tmpdir(), `markivo-ctrans-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = 'fake_test_key_123';
process.env.GEMINI_FALLBACK_MODEL = '';

const realFetch = global.fetch;
let calls = [];
let failing = false;
// Stub translator: prefixes every text with the target language, so a test
// can see exactly which fields were translated.
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, opts);
  const body = JSON.parse(opts.body);
  calls.push(body);
  if (failing) throw new TypeError('fetch failed');
  const lang = /into (Uzbek|Russian|English)/.exec(body.system_instruction)[1];
  const { items } = JSON.parse(body.input);
  const text = JSON.stringify({ items: items.map((it) => ({ id: it.id, text: `[${lang}] ${it.text}` })) });
  return { ok: true, status: 200, json: async () => ({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] }) };
};

const createDb = require('../db');
const contentTranslate = require('../contentTranslate');

const db = createDb(TMP_DB);
after(() => {
  global.fetch = realFetch;
  db.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) fs.rmSync(f, { force: true });
});

const user = db.users.create({ email: `t${Date.now()}@m.uz`, passwordHash: 'x', fullName: 'T' });
const profile = db.profiles.create({ userId: user.id, businessName: 'Noir', category: 'Cafe' });

const fullBrief = {
  mode: 'full', kind: 'image', lang: 'en', engineStatus: 'ready',
  concept: 'An iced latte on a marble counter.',
  headline: '20% off iced lattes',
  caption: 'This weekend only. #noirkafe',
  visualSpec: { composition: 'hero glass centre', palette: 'cream and espresso', mood: 'sunny' },
  renderPrompt: 'Photoreal ad: an iced latte, headline "20% off iced lattes".',
};

test('a saved brief is shown in the new language — directions translated, model-facing text untouched', async () => {
  calls = [];
  const row = db.media.add({ profileId: profile.id, kind: 'image', mode: 'full', topic: 'iced latte', brief: fullBrief, status: 'brief' });
  const out = await contentTranslate.localizeMedia(db, row, 'uz', {});
  assert.strictEqual(out.brief.concept, '[Uzbek] An iced latte on a marble counter.');
  assert.strictEqual(out.brief.visualSpec.mood, '[Uzbek] sunny');
  assert.strictEqual(out.brief.caption, '[Uzbek] This weekend only. #noirkafe', 'no audience set: the caption follows the owner');
  assert.strictEqual(out.brief.headline, fullBrief.headline, 'the headline is baked into the image');
  assert.strictEqual(out.brief.renderPrompt, fullBrief.renderPrompt);
  assert.strictEqual(out.brief.translations, undefined, 'the cache never reaches the client');
  assert.strictEqual(calls.length, 1, 'one batched call for the whole brief');

  // Second view: served from the record, no new call.
  calls = [];
  const again = await contentTranslate.localizeMedia(db, db.media.findById(row.id), 'uz', {});
  assert.strictEqual(again.brief.concept, '[Uzbek] An iced latte on a marble counter.');
  assert.strictEqual(calls.length, 0);

  // Back in the original language: the original, no call.
  const en = await contentTranslate.localizeMedia(db, db.media.findById(row.id), 'en', {});
  assert.strictEqual(en.brief.concept, fullBrief.concept);
  assert.strictEqual(calls.length, 0);
});

test('with audience languages set, the caption and spoken lines stay as written for customers', async () => {
  const row = db.media.add({ profileId: profile.id, kind: 'image', mode: 'full', topic: 'x', brief: fullBrief, status: 'brief' });
  const out = await contentTranslate.localizeMedia(db, row, 'ru', { audienceLanguages: ['uz'] });
  assert.strictEqual(out.brief.caption, fullBrief.caption);
  assert.strictEqual(out.brief.concept, '[Russian] An iced latte on a marble counter.');
});

test('an edit plan is translated on its own, from its own language', async () => {
  const brief = { mode: 'guided', kind: 'video', lang: 'uz', scene: "Deraza yonida suratga oling va fonni toza qiling.",
    editPlan: { lang: 'en', steps: ['Trim to the best 5 seconds'], crop: '9:16 vertical' } };
  const row = db.media.add({ profileId: profile.id, kind: 'video', mode: 'guided', topic: 'x', brief, status: 'brief' });
  const out = await contentTranslate.localizeMedia(db, row, 'uz', {});
  assert.strictEqual(out.brief.scene, brief.scene, 'already Uzbek');
  assert.strictEqual(out.brief.editPlan.steps[0], '[Uzbek] Trim to the best 5 seconds');
  const stored = db.media.findById(row.id).brief;
  assert.ok(stored.editPlan.translations.uz, 'the plan keeps its own translation');
  assert.strictEqual(stored.translations, undefined, 'nothing to translate on the brief itself');
});

test('a competitor insight follows the language too, and an untagged old one is detected', async () => {
  const insight = db.competitorInsights.add({ profileId: profile.id, analysis: {
    analysis: 'Your competitors post 4 times a week, mostly video.',
    themes: ['Behind the counter', 'Daily specials'],
    recommendation: 'Film one short video of the morning bake this week.',
  } });
  const out = await contentTranslate.localizeInsight(db, insight, 'uz');
  assert.strictEqual(out.analysis.themes[1], '[Uzbek] Daily specials');
  assert.strictEqual(db.competitorInsights.latestByProfile(profile.id).analysis.lang, 'en', 'the detected source is recorded');
});

test('when translation is unavailable the original is shown, and nothing is cached', async () => {
  failing = true;
  try {
    const row = db.media.add({ profileId: profile.id, kind: 'image', mode: 'full', topic: 'x', brief: fullBrief, status: 'brief' });
    const out = await contentTranslate.localizeMedia(db, row, 'ru', {});
    assert.strictEqual(out.brief.concept, fullBrief.concept);
    assert.strictEqual(db.media.findById(row.id).brief.translations, undefined);
  } finally {
    failing = false;
  }
});
