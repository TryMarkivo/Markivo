const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// The keyless templates — what every generator falls back to without a key or
// when the live call fails — speak the owner's UI language too. Uzbek owners
// get Uzbek; everyone else gets the English they always got. Keyless: '' (not
// delete) so a real key in .env cannot switch the providers on. Set env BEFORE
// requiring the app — config caches env at load.
const TMP_DB = path.join(os.tmpdir(), `markivo-owner-fallback-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.AI_LIMIT_FREEMIUM_WRITING = '30';

const ai = require('../ai');
const brand = require('../brand');
const { app } = require('../server');

const UZ = require('../locales/uz.json');
const UZ_TEXT = new Set(Object.values(UZ));

const PROFILE = { businessName: 'Noir Coffee', category: 'Cafe / Coffee Shop', brandTone: 'Modern & Minimalist' };

/** Every string in a nested value, as [path, string] — paths like "shotList.2.name". */
function leaves(value, at = '') {
  if (typeof value === 'string') return [[at, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, at ? `${at}.${k}` : k));
}

// Fields that are not prose: identical in every language by design.
const FIXED = /^(mode|kind|engineStatus|script\.\d+\.time)$/;
// What a CUSTOMER reads or hears — follows the audience, not the owner.
const CUSTOMER = /^(caption|script\.\d+\.onScreenText|script\.[013]\.spoken)$/;

/** Asserts every owner-facing sentence of `uz` differs from its English twin. */
function assertOwnerTextTranslated(uz, en, label) {
  const english = new Map(leaves(en));
  const owner = leaves(uz).filter(([at]) => !FIXED.test(at) && !CUSTOMER.test(at));
  assert.ok(owner.length >= 4, `${label}: has owner-facing text`);
  for (const [at, text] of owner) {
    if (!/\p{L}/u.test(english.get(at) || '')) continue; // e.g. an angle of "45°"
    assert.notStrictEqual(text, english.get(at), `${label}: ${at} is still English`);
  }
}

test('the keyless media brief directs an Uzbek owner in Uzbek, in every mode', async () => {
  for (const [kind, mode] of [['video', 'guided'], ['image', 'guided'], ['image', 'full'], ['video', 'full']]) {
    const ctx = { kind, mode, topic: 'latte', profile: PROFILE, trends: 'Raqiblar videoga tayanmoqda' };
    const uz = await ai.generateMediaBrief({ ...ctx, lang: 'uz' });
    const en = await ai.generateMediaBrief(ctx);
    assert.deepStrictEqual(Object.keys(uz), Object.keys(en), `${kind}/${mode}: same shape`);
    assertOwnerTextTranslated(uz, en, `${kind}/${mode}`);
    assert.ok(!/\$\{|\{\{/.test(JSON.stringify(uz)), `${kind}/${mode}: no leftover placeholder`);
  }

  const video = await ai.generateMediaBrief({ kind: 'video', mode: 'guided', topic: 'latte', profile: PROFILE, lang: 'uz' });
  assert.strictEqual(video.tips[0], "Avval obyektivni arting — bu sifatni oshirishning eng arzon yo'li.");
  // The tone reads the way the app's tone picker names it.
  assert.match(video.tips[3], /^"Zamonaviy va minimalistik" brend ohangingizga/);
});

test('customer lines in a keyless brief follow the audience; with none set, the owner\'s language', async () => {
  const ctx = { kind: 'video', mode: 'guided', topic: 'latte', profile: PROFILE };

  // No audience set: the Uzbek owner's customer lines are Uzbek too.
  const uzOnly = await ai.generateMediaBrief({ ...ctx, lang: 'uz' });
  assert.strictEqual(uzOnly.script[0].onScreenText, 'Noir Coffee taqdim etadi: latte');
  assert.strictEqual(uzOnly.script[3].spoken, "Kelib, o'zingiz ko'ring.");

  // A Russian-reading audience: customer lines in Russian, directions still Uzbek.
  const ruAudience = await ai.generateMediaBrief({ ...ctx, lang: 'uz', languages: ['ru'] });
  assert.strictEqual(ruAudience.script[0].onScreenText, 'latte — в Noir Coffee');
  assert.strictEqual(ruAudience.camera.device, uzOnly.camera.device);

  // An English owner with an Uzbek-then-Russian audience: English directions,
  // customer lines stacked in the audience's order.
  const full = await ai.generateMediaBrief({ ...ctx, mode: 'full', kind: 'image', lang: 'en', languages: ['uz', 'ru'] });
  const english = await ai.generateMediaBrief({ ...ctx, mode: 'full', kind: 'image' });
  assert.strictEqual(full.concept, english.concept);
  assert.strictEqual(full.caption,
    "✨ Yangi: latte! Noir Coffee sizni kutadi — kelib, o'zingiz ko'ring.\n\n" +
    '✨ latte — теперь в Noir Coffee! Приходите и убедитесь сами. #noircoffee #cafecoffeeshop');
});

test('with no language at all the brief is the English it always was', async () => {
  const ctx = { kind: 'video', mode: 'guided', topic: 'latte', profile: PROFILE };
  const plain = await ai.generateMediaBrief(ctx);
  assert.deepStrictEqual(await ai.generateMediaBrief({ ...ctx, lang: 'en' }), plain);
  assert.deepStrictEqual(await ai.generateMediaBrief({ ...ctx, languages: ['en'] }), plain);
  assert.strictEqual(plain.camera.device, 'Any modern smartphone works — a mirrorless camera only pays off if you already own one.');
  assert.strictEqual(plain.script[0].onScreenText, 'latte — at Noir Coffee');
  assert.strictEqual(plain.script[3].onScreenText, 'Noir Coffee — open today');
  const full = await ai.generateMediaBrief({ ...ctx, mode: 'full', kind: 'image' });
  assert.strictEqual(full.caption, '✨ latte — now at Noir Coffee! Come see it for yourself. #noircoffee #cafecoffeeshop');

  // A Russian owner still reads English directions (there is no Russian template).
  const ru = await ai.generateMediaBrief({ ...ctx, lang: 'ru' });
  assert.strictEqual(ru.camera.device, plain.camera.device);
});

test('the keyless edit plan reads in Uzbek; English stays the default', async () => {
  const ctx = { instructions: 'iliqroq qiling', media: { kind: 'video' }, profile: PROFILE };
  const uz = await ai.generateEditPlan({ ...ctx, lang: 'uz' });
  const en = await ai.generateEditPlan(ctx);
  assert.deepStrictEqual(Object.keys(uz), Object.keys(en));
  assertOwnerTextTranslated(uz, en, 'edit plan');
  assert.strictEqual(uz.steps[0], "Xom videoni ko'rib chiqing va eng kuchli 3-5 soniyani yoki eng yaxshi bitta kadrni belgilang");
  assert.strictEqual(uz.steps[1], "Avval so'rovingizni qo'llang: iliqroq qiling");
  assert.strictEqual(en.steps[1], "Apply the owner's request first: iliqroq qiling");
  assert.deepStrictEqual(await ai.generateEditPlan({ ...ctx, lang: 'en' }), en);
});

test('keyless competitor trends speak Uzbek in every branch; English and Russian stay English', async () => {
  const cases = [
    { competitorStats: [], trackedCompetitors: [] },
    { competitorStats: [{ postCount: 0 }], trackedCompetitors: [{ name: 'FB Rival', platforms: ['facebook'] }] },
    { competitorStats: [{ postCount: 0 }], trackedCompetitors: [{ name: 'A', platforms: ['instagram'] }, { name: 'B', platforms: ['youtube'] }] },
    { competitorStats: [], trackedCompetitors: [{ name: 'Rival YouTube', platforms: ['youtube'] }] },
    { competitorStats: [{ postCount: 10, postsPerWeek: 4, videoSharePercent: 80 }, { postCount: 6, postsPerWeek: 2, videoSharePercent: 20 }] },
    { competitorStats: [{ postCount: 4, postsPerWeek: 1, videoSharePercent: 10 }] },
  ];
  for (const c of cases) {
    const uz = await ai.analyzeCompetitorTrends({ businessName: 'Noir Coffee', ...c, lang: 'uz' });
    const en = await ai.analyzeCompetitorTrends({ businessName: 'Noir Coffee', ...c });
    assert.notStrictEqual(uz.analysis, en.analysis);
    assert.doesNotMatch(uz.analysis, /\b(the|is|are|your|their|of)\b/, 'every sentence of the analysis is translated');
    assert.ok(UZ_TEXT.has(uz.recommendation), `untranslated: ${uz.recommendation}`);
    uz.themes.forEach((t) => assert.ok(UZ_TEXT.has(t), `untranslated: ${t}`));
    assert.deepStrictEqual(await ai.analyzeCompetitorTrends({ businessName: 'Noir Coffee', ...c, lang: 'ru' }), en);
  }

  const none = await ai.analyzeCompetitorTrends({ businessName: 'Noir Coffee', lang: 'uz' });
  assert.match(none.analysis, /^Hali Noir Coffee uchun birorta raqobatchi kuzatilmayapti/);
  const nameless = await ai.analyzeCompetitorTrends({ lang: 'uz' });
  assert.match(nameless.analysis, /^Hali biznesingiz uchun/);
  const data = await ai.analyzeCompetitorTrends({ lang: 'uz', competitorStats: cases[4].competitorStats });
  assert.strictEqual(data.analysis, "Kuzatilayotgan 2 ta raqobatchi haftasiga o'rtacha 3 ta post joylaydi, ularning kontentining taxminan 50 foizi — video.");
  assert.strictEqual(
    (await ai.analyzeCompetitorTrends({ competitorStats: cases[4].competitorStats })).analysis,
    'Across 2 tracked competitors, average posting cadence is 3 posts/week and about 50% of their content is video.',
  );
});

test('Autopilot\'s keyless analysis is written for the Uzbek owner; the posts are untouched', async () => {
  const ctx = { platforms: ['instagram', 'telegram'], businessName: 'Noir', category: 'Cafe', description: 'A tiny espresso bar' };
  const uz = await ai.analyzeAndPlan({ ...ctx, lang: 'uz' });
  const en = await ai.analyzeAndPlan(ctx);
  assert.strictEqual(uz.analysis, 'Profilingiz va tavsifingiz asosida Noir uchun 2 ta reklama posti tayyorlandi.');
  assert.strictEqual(en.analysis, 'Drafted 2 promotional posts for Noir from your profile and description.');
  assert.deepStrictEqual(uz.posts, en.posts);
  assert.strictEqual((await ai.analyzeAndPlan({ platforms: ['instagram'] })).analysis,
    'Drafted 1 promotional post for your business from your profile.');
  assert.strictEqual((await ai.analyzeAndPlan({ platforms: ['instagram'], lang: 'uz' })).analysis,
    'Profilingiz asosida biznesingiz uchun 1 ta reklama posti tayyorlandi.');
});

test('keyless slogans come in Uzbek for every tone; English is unchanged', async () => {
  for (const tone of ['Cozy & Warm', 'Modern & Minimalist', 'Energetic & Fast-paced', 'Professional & Trustworthy', 'Playful & Fun', 'Luxury & Premium', 'A tone nobody picked']) {
    const uz = await ai.generateSlogans({ businessName: 'Noir', category: 'Cafe', tone, lang: 'uz' });
    const en = await ai.generateSlogans({ businessName: 'Noir', category: 'Cafe', tone });
    assert.strictEqual(uz.length, 3);
    uz.forEach((s) => assert.ok(!en.includes(s), `${tone}: "${s}" is English`));
  }
  assert.deepStrictEqual(await ai.generateSlogans({ tone: 'Modern & Minimalist' }),
    ['Simplicity, refined.', 'The future of quality, today.', 'Clean aesthetics. Superior standards.']);
});

test('the keyless brand brief is Uzbek for an Uzbek owner, without the English-first caption rule', async () => {
  const ctx = { businessName: 'Chashka Coffee', category: 'Coffee Shop', brandTone: 'Cozy & Warm', description: 'A tiny espresso bar' };
  const uz = await brand.generateBrandBrief({ ...ctx, lang: 'uz' });
  const en = await brand.generateBrandBrief(ctx);
  assert.deepStrictEqual(Object.keys(uz), Object.keys(en));
  assertOwnerTextTranslated(uz, en, 'brand brief');
  assert.ok(uz.positioning.startsWith('Chashka Coffee — '));
  assert.match(uz.positioning, /"Shinam va iliq" ruhidagi/);
  assert.ok(!/\$\{/.test(JSON.stringify(uz)), 'no leftover ${} placeholders');
  assert.ok(!/English/.test(uz.voiceDo.join(' ')), 'no English-first caption rule');
  assert.match(en.voiceDo.join(' '), /Keep English-first captions/);
  assert.deepStrictEqual(await brand.generateBrandBrief({ ...ctx, lang: 'en' }), en);
  // The digest every generator reads still parses the Uzbek brief.
  assert.match(brand.briefDigest(uz, ctx), /FACTS: none provided/);
});

// ---------------------------------------------------------------------------
// End to end: the owner's Accept-Language reaches each template.
// ---------------------------------------------------------------------------

let server, base, access;
const call = (method) => (p, body, lang = 'uz') =>
  fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': lang,
      ...(access ? { Authorization: `Bearer ${access}` } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  });
const get = call('GET');
const post = call('POST');

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await post('/api/auth/register', { email: `uzk${Date.now()}@m.uz`, password: 'secret123', fullName: 'Uz Owner' });
  access = (await reg.json()).accessToken;
  const built = await post('/api/onboarding/construct', { businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm' });
  assert.strictEqual(built.status, 200);
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) fs.rmSync(f, { force: true });
});

test('an Uzbek owner gets Uzbek fallbacks from every keyless route', async () => {
  // Onboarding wrote the brand brief in the owner's language.
  const stored = await (await get('/api/brand')).json();
  assert.ok(stored.brandBrief.positioning.startsWith('Noir Cafe — '), stored.brandBrief.positioning);

  const brief = await (await post('/api/media/brief', { kind: 'video', mode: 'guided', topic: 'latte' })).json();
  assert.strictEqual(brief.brief.tips[0], "Avval obyektivni arting — bu sifatni oshirishning eng arzon yo'li.");

  const edit = await (await post(`/api/media/${brief.id}/edit`, { instructions: 'iliqroq qiling' })).json();
  assert.strictEqual(edit.plan.steps[1], "Avval so'rovingizni qo'llang: iliqroq qiling");

  const trends = await (await post('/api/competitors/analyze')).json();
  assert.match(trends.insight.analysis.analysis, /^Hali Noir Cafe uchun birorta raqobatchi kuzatilmayapti/);

  const slogans = await (await post('/api/onboarding/slogans', { businessName: 'Noir Cafe', tone: 'Playful & Fun' })).json();
  assert.deepStrictEqual(slogans.slogans, ['Kuningizga bir tomchi quvonch!', 'Avval tabassum, savollar keyin.', 'Kundalik quvonch ulushingiz.']);

  const regenerated = await (await post('/api/brand/generate')).json();
  assert.match(regenerated.brandBrief.positioning, /"Shinam va iliq" ruhidagi/);
});

test('the same keyless routes stay English for an English owner', async () => {
  const brief = await (await post('/api/media/brief', { kind: 'video', mode: 'guided', topic: 'latte' }, 'en')).json();
  assert.strictEqual(brief.brief.tips[0], 'Wipe the lens first — it is the cheapest quality upgrade there is.');

  const trends = await (await post('/api/competitors/analyze', {}, 'en')).json();
  assert.match(trends.insight.analysis.analysis, /^No competitors tracked yet for Noir Cafe/);

  const regenerated = await (await post('/api/brand/generate', {}, 'en')).json();
  assert.ok(regenerated.brandBrief.positioning.startsWith('For locals near Noir Cafe'));
});
