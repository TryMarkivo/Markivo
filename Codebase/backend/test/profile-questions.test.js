const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate the test DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-profileq-test-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const pq = require('../profileQuestions');
const brand = require('../brand');
const gemini = require('../gemini');
const ai = require('../ai');
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

const req = (method) => (p, body, token) =>
  fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = req('POST');
const get = (p, token) => fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

// ---------------------------------------------------------------------------
// sanitize — the guard between a live model and the owner's screen
// ---------------------------------------------------------------------------

test('sanitize drops questions that re-ask what onboarding already collected', () => {
  const out = pq.sanitize([
    { key: 'location', label: 'Where are you based?', hint: '', placeholder: '', type: 'text' },
    { key: 'target_audience', label: 'Who is your customer?', hint: '', placeholder: '', type: 'text' },
    { key: 'signature_drink', label: 'Which drink do regulars order?', hint: 'h', placeholder: 'p', type: 'text' },
    { key: 'busiest_hours', label: 'When is it busiest?', hint: 'h', placeholder: 'p', type: 'text' },
  ]);
  assert.deepStrictEqual(out.map((q) => q.key), ['signature_drink', 'busiest_hours']);
});

test('sanitize dedupes keys, normalises them, and caps the set at 5', () => {
  const raw = Array.from({ length: 9 }, (_, i) => ({
    key: `Question Key ${i}`, label: `Label ${i}`, hint: 'h', placeholder: 'p', type: 'text',
  }));
  raw.push({ key: 'Question Key 0', label: 'A duplicate', hint: 'h', placeholder: 'p', type: 'text' });
  const out = pq.sanitize(raw);
  assert.strictEqual(out.length, 5);
  assert.deepStrictEqual(out.map((q) => q.key), ['question_key_0', 'question_key_1', 'question_key_2', 'question_key_3', 'question_key_4']);
});

test('sanitize forces an unrenderable type back to text and tags the source', () => {
  const [q] = pq.sanitize([
    { key: 'order_channel', label: 'How do people order?', hint: 'h', placeholder: 'p', type: 'radio' },
    { key: 'delivery_area', label: 'Where do you deliver?', hint: 'h', placeholder: 'p', type: 'textarea' },
  ]);
  assert.strictEqual(q.type, 'text');
  assert.strictEqual(q.source, 'gemini');
});

test('sanitize returns null when too little survives, so the caller can fall back', () => {
  assert.strictEqual(pq.sanitize(null), null);
  assert.strictEqual(pq.sanitize([{ key: 'category', label: 'What category?' }]), null);
  assert.strictEqual(pq.sanitize([{ key: 'ok_key', label: '' }, { key: 'x', label: 'too short a key' }]), null);
});

test('the keyless fallback is category-aware and never empty', () => {
  const cafe = pq.fallbackQuestions('Cafe / Coffee Shop');
  const salon = pq.fallbackQuestions('Beauty Salon / Spa');
  const unknown = pq.fallbackQuestions('Something Nobody Listed');
  assert.ok(cafe.length >= 2 && salon.length >= 2 && unknown.length >= 2);
  assert.notDeepStrictEqual(cafe.map((q) => q.key), salon.map((q) => q.key));
  assert.ok(cafe.every((q) => q.source === 'template'));
});

// ---------------------------------------------------------------------------
// completion + routing
// ---------------------------------------------------------------------------

test('a value already on the profile counts as answered and is never re-asked', () => {
  const bare = pq.completion({});
  const withTone = pq.completion({ brandTone: 'Cozy & Warm', slogan: 'Simplicity, refined.' });
  assert.strictEqual(withTone.pendingCount, bare.pendingCount - 2);
  assert.ok(!withTone.pending.some((q) => q.key === 'brandTone' || q.key === 'slogan'));
});

test('an explicit skip stops the question being asked without inventing a value', () => {
  const profile = { profileAnswers: { hours: { value: null, at: 'now', source: 'panel' } } };
  const state = pq.completion(profile);
  assert.ok(!state.pending.some((q) => q.key === 'hours'));
  const row = pq.view(profile).find((q) => q.key === 'hours');
  assert.strictEqual(row.skipped, true);
  assert.strictEqual(row.value, '');
});

test('applyAnswers routes fixed answers to real columns and businessFacts', () => {
  const fields = pq.applyAnswers({}, {
    brandTone: 'Modern & Minimalist',
    signatureItems: 'honey cake, filter coffee',
    hours: 'Mon-Sat 9-21',
  });
  assert.strictEqual(fields.brandTone, 'Modern & Minimalist');
  assert.deepStrictEqual(fields.brandBrief.businessFacts.signatureItems, ['honey cake', 'filter coffee']);
  assert.strictEqual(fields.brandBrief.businessFacts.hours, 'Mon-Sat 9-21');
  assert.strictEqual(fields.profileAnswers.brandTone.source, 'panel');
});

test('applyAnswers keeps a closed list closed and ignores unknown keys', () => {
  const fields = pq.applyAnswers({}, { brandTone: 'Screaming & Loud', not_a_question: 'x' });
  assert.strictEqual(fields.brandTone, undefined);            // never written to brand_tone
  assert.ok(fields.profileAnswers.brandTone);                 // but the owner's words are kept
  assert.strictEqual(fields.profileAnswers.not_a_question, undefined);
  assert.strictEqual(pq.applyAnswers({}, { not_a_question: 'x' }), null);
});

test('applyAnswers preserves businessFacts it was not asked about', () => {
  const profile = { brandBrief: { positioning: 'p', businessFacts: { phone: '+998 90 000 00 00' } } };
  const fields = pq.applyAnswers(profile, { hours: '9-21' });
  assert.strictEqual(fields.brandBrief.businessFacts.phone, '+998 90 000 00 00');
  assert.strictEqual(fields.brandBrief.positioning, 'p');
});

test('answers to the AI-written questions reach the model through briefDigest', () => {
  const profile = {
    businessName: 'Noir Cafe',
    profileQuestions: [{ key: 'signature_drink', label: 'Which drink do regulars order?', source: 'gemini' }],
    profileAnswers: { signature_drink: { value: 'the cardamom latte', at: 'now', source: 'markiv' } },
  };
  const digest = brand.briefDigest({ positioning: 'p', businessFacts: {} }, profile);
  assert.match(digest, /Which drink do regulars order\? -> the cardamom latte/);
  // …and in the no-brief shape too, where a thin profile is all the model gets.
  assert.match(brand.briefDigest(null, profile), /the cardamom latte/);
});

// ---------------------------------------------------------------------------
// audience languages — the answer that steers every generator
// ---------------------------------------------------------------------------

test('audienceLanguages keeps the order picked and drops anything off-list', () => {
  const fields = pq.applyAnswers({}, { audienceLanguages: 'uz, ru' });
  assert.deepStrictEqual(fields.audienceLanguages, ['uz', 'ru']);   // not re-sorted to en-first

  const bad = pq.applyAnswers({}, { audienceLanguages: 'klingon' });
  assert.strictEqual(bad.audienceLanguages, undefined);
  assert.ok(bad.profileAnswers.audienceLanguages, 'the raw answer is still recorded');
});

test('an empty language list still counts as unanswered', () => {
  assert.ok(pq.completion({ audienceLanguages: [] }).pending.some((q) => q.key === 'audienceLanguages'));
  assert.ok(!pq.completion({ audienceLanguages: ['uz'] }).pending.some((q) => q.key === 'audienceLanguages'));
});

test('the media-brief language rule scopes itself to customer-facing words', () => {
  const rule = gemini.mediaLangRule(['uz', 'ru']);
  assert.match(rule, /Uzbek \(Latin script\), then Russian/);
  assert.match(rule, /in exactly that order/);
  assert.match(rule, /stay in English/);           // directions to the owner are not translated
  assert.strictEqual(gemini.mediaLangRule([]), '');  // unanswered leaves briefs untouched
  assert.strictEqual(gemini.mediaLangRule(undefined), '');
});

test('the keyless copy template writes in the audience languages, in order', () => {
  const uzFirst = ai.templateContent({ platform: 'telegram', topic: 'Weekend offer', businessName: 'Noir', languages: ['uz', 'ru'] });
  const ruFirst = ai.templateContent({ platform: 'telegram', topic: 'Weekend offer', businessName: 'Noir', languages: ['ru', 'uz'] });
  assert.ok(uzFirst.post.indexOf('🇺🇿') < uzFirst.post.indexOf('🇷🇺'));
  assert.ok(ruFirst.post.indexOf('🇷🇺') < ruFirst.post.indexOf('🇺🇿'));
});

test('the agent prompt block disappears once nothing is pending', () => {
  const block = pq.agentPromptBlock({});
  assert.match(block, /MISSING BUSINESS DETAILS/);
  assert.match(block, /save_business_detail/);

  const answers = {};
  for (const q of pq.FIXED) answers[q.key] = { value: null, at: 'now', source: 'panel' };
  assert.strictEqual(pq.agentPromptBlock({ profileAnswers: answers }), '');
});

// ---------------------------------------------------------------------------
// routes
// ---------------------------------------------------------------------------

let token;

test('GET /api/profile/completion is 404 before onboarding, 401 without a token', async () => {
  assert.strictEqual((await get('/api/profile/completion')).status, 401);

  const email = `pq${Date.now()}@markivo.uz`;
  const reg = await (await post('/api/auth/register', { email, password: 'secret123', fullName: 'Q Owner' })).json();
  token = reg.accessToken;
  assert.strictEqual((await get('/api/profile/completion', token)).status, 404);
});

test('GET /api/profile/completion generates the set once and caches it', async () => {
  const construct = await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', location: 'Tashkent',
    description: 'A small specialty coffee bar.', audience: 'Students and remote workers',
    platforms: { instagram: true },
  }, token);
  assert.strictEqual(construct.status, 200);

  const first = await (await get('/api/profile/completion', token)).json();
  assert.ok(first.questions.length > pq.FIXED.length);       // fixed + generated
  assert.strictEqual(first.pendingCount, first.total);        // nothing answered yet
  assert.strictEqual(first.engine, 'template');               // keyless in tests

  const second = await (await get('/api/profile/completion', token)).json();
  assert.deepStrictEqual(second.questions.map((q) => q.key), first.questions.map((q) => q.key));
});

test('POST /api/profile/answers saves, drops the pending count, and updates the profile', async () => {
  const before = await (await get('/api/profile/completion', token)).json();
  const res = await post('/api/profile/answers', {
    answers: { brandTone: 'Cozy & Warm', hours: 'Mon-Sat 9:00-21:00' },
  }, token);
  assert.strictEqual(res.status, 200);

  const data = await res.json();
  assert.strictEqual(data.pendingCount, before.pendingCount - 2);
  assert.strictEqual(data.profile.brandTone, 'Cozy & Warm');
  assert.strictEqual(data.profile.brandBrief.businessFacts.hours, 'Mon-Sat 9:00-21:00');
  assert.ok(data.profile.platforms, 'the dashboard needs the platforms map back');

  const tone = data.questions.find((q) => q.key === 'brandTone');
  assert.strictEqual(tone.answered, true);
  assert.strictEqual(tone.value, 'Cozy & Warm');
});

test('POST /api/profile/answers survives a restart — the answers are persisted', async () => {
  const after = await (await get('/api/profile/completion', token)).json();
  assert.strictEqual(after.questions.find((q) => q.key === 'hours').value, 'Mon-Sat 9:00-21:00');
});

test('POST /api/profile/answers rejects a malformed or unrecognised body', async () => {
  assert.strictEqual((await post('/api/profile/answers', {}, token)).status, 400);
  assert.strictEqual((await post('/api/profile/answers', { answers: [] }, token)).status, 400);
  assert.strictEqual((await post('/api/profile/answers', { answers: { nope: 'x' } }, token)).status, 400);
});
