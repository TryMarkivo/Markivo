const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// The owner's UI language reaches what the server writes for them: the AI's
// explanations and the fixed sentences. Post copy keeps following the
// audience's languages. Set env BEFORE requiring the app — config caches env
// at load. A fake Gemini key makes the live engine answer, through the stub.
const TMP_DB = path.join(os.tmpdir(), `markivo-owner-lang-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = 'fake_test_key_123';
process.env.GEMINI_FALLBACK_MODEL = '';
process.env.AI_LIMIT_FREEMIUM_WRITING = '30';

const realFetch = global.fetch;
let onGemini = null;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, opts);
  const answer = onGemini && onGemini(JSON.parse(opts.body), u);
  if (!answer) throw new TypeError('fetch failed');
  return { ok: true, status: 200, json: async () => answer };
};
const completed = (obj) => ({
  status: 'completed',
  steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(obj) }] }],
});

const i18n = require('../i18n');
const gemini = require('../gemini');
const profileQuestions = require('../profileQuestions');
const autopilotContext = require('../autopilotContext');
const connectors = require('../connectors/registry');
const { app } = require('../server');

const UZ = require('../locales/uz.json');

let server, base, access;
const call = (method) => (p, body, lang = 'uz') =>
  realFetch(base + p, {
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
  const reg = await post('/api/auth/register', { email: `uz${Date.now()}@m.uz`, password: 'secret123', fullName: 'Uz Owner', preferredLang: 'uz' });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop' });
});

after(() => {
  onGemini = null;
  global.fetch = realFetch;
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) fs.rmSync(f, { force: true });
});

test('a media brief from an Uzbek UI directs the owner in Uzbek and keeps the render prompt English', async () => {
  let system;
  onGemini = (body) => {
    if (!String(body.input).includes('a latte on the window bar')) return null;
    system = body.system_instruction;
    return completed({
      concept: 'Deraza yonidagi latte', headline: 'Latte', caption: 'Latte ☕',
      visualSpec: { composition: 'markazda', palette: 'krem', mood: 'iliq' },
      renderPrompt: 'Photoreal ad: a latte on a window bar.',
    });
  };
  const res = await post('/api/media/brief', { kind: 'image', mode: 'full', topic: 'a latte on the window bar' });
  assert.strictEqual(res.status, 200);
  assert.match(system, /OWNER LANGUAGE/);
  assert.match(system, /directions TO THE OWNER[^.]*are written in Uzbek \(Latin script\)/);
  assert.match(system, /The renderPrompt stays in English/);
});

test('an English UI leaves the brief exactly as before', () => {
  assert.strictEqual(gemini.mediaLangRule(undefined, 'en'), '');
  assert.strictEqual(gemini.mediaLangRule(undefined, undefined), '');
  assert.match(gemini.mediaLangRule(['uz', 'ru'], 'en'), /stay in English/);
  assert.match(gemini.mediaLangRule(['uz', 'ru'], 'uz'), /must be written in Uzbek \(Latin script\), then Russian/);
  assert.strictEqual(gemini.ownerLangRule('en', 'anything'), '');
});

test('profile questions are written in Uzbek, then reworded — same keys — when the owner switches language', async () => {
  let asked;
  onGemini = (body) => {
    if (!/follow-up questions/.test(body.system_instruction || '')) return null;
    if (/^You translate/.test(body.system_instruction)) {
      asked = body.system_instruction;
      const { questions } = JSON.parse(body.input);
      return completed({ questions: questions.map((q) => ({ ...q, label: `EN ${q.key}`, hint: 'why', placeholder: 'e.g.', type: 'text' })) });
    }
    asked = body.system_instruction;
    return completed({
      questions: [
        { key: 'window_seats', label: 'Deraza yonida nechta joy bor?', hint: 'Rasm uchun', placeholder: 'masalan, 6', type: 'text' },
        { key: 'morning_rush', label: 'Ertalab qachon gavjum?', hint: 'Rejalash uchun', placeholder: 'masalan, 8-10', type: 'text' },
      ],
    });
  };

  const first = await (await get('/api/profile/completion')).json();
  assert.match(asked, /OWNER LANGUAGE[^]*Uzbek \(Latin script\)/);
  const uzQuestion = first.questions.find((q) => q.key === 'window_seats');
  assert.strictEqual(uzQuestion.label, 'Deraza yonida nechta joy bor?');

  const second = await (await get('/api/profile/completion', undefined, 'en')).json();
  assert.match(asked, /^You translate the follow-up questions .* into English/);
  assert.deepStrictEqual(
    second.questions.filter((q) => !q.fixed).map((q) => q.key),
    first.questions.filter((q) => !q.fixed).map((q) => q.key),
    'keys never change, so answers stay attached',
  );
  assert.strictEqual(second.questions.find((q) => q.key === 'window_seats').label, 'EN window_seats');

  // Back in English already — no further translation call.
  asked = null;
  await get('/api/profile/completion', undefined, 'en');
  assert.strictEqual(asked, null);
});

test('the keyless question templates exist in Uzbek', () => {
  for (const category of ['Cafe', 'Beauty salon', 'Coworking', 'Clothing store', 'Restaurant', 'IT agency', 'Plumber']) {
    const en = profileQuestions.fallbackQuestions(category, 'en');
    const uz = profileQuestions.fallbackQuestions(category, 'uz');
    assert.deepStrictEqual(uz.map((q) => q.key), en.map((q) => q.key));
    uz.forEach((q, i) => {
      for (const field of ['label', 'hint', 'placeholder']) {
        assert.notStrictEqual(q[field], en[i][field], `${category} ${q.key}.${field} is still English`);
      }
    });
  }
});

test('Autopilot asks for missing context in the owner\'s language', () => {
  const out = autopilotContext.heuristicAssessment({}, 'uz');
  assert.strictEqual(out.sufficient, false);
  assert.strictEqual(out.questions.length, 3);
  for (const q of out.questions) assert.ok(UZ[Object.keys(UZ).find((k) => UZ[k] === q)], `untranslated: ${q}`);
  assert.match(out.rationale, /^Avtopilotda/);
});

test('connect guidance and style names read in Uzbek', async () => {
  const status = await (await get('/api/connect/status')).json();
  const english = new Map(connectors.catalogue().map((c) => [c.key, c]));
  for (const c of status.catalogue) {
    const en = english.get(c.key);
    [...c.requirements, ...c.howToConnect].forEach((line) => {
      assert.ok(![...en.requirements, ...en.howToConnect].includes(line), `${c.key}: still English — ${line}`);
    });
  }
  const presets = await (await get('/api/styles/presets')).json();
  assert.ok(presets.every((p) => p.label !== gemini.STYLE_PRESETS.find((s) => s.key === p.key).label));
});

test('when the live engine fails, the fallback still speaks to the Uzbek owner in Uzbek', async () => {
  onGemini = () => null; // every Gemini call fails, so each generator lands on its template
  const brief = await (await post('/api/media/brief', { kind: 'image', mode: 'guided', topic: 'latte' })).json();
  assert.strictEqual(brief.brief.tips[0], "Avval obyektivni arting — bu sifatni oshirishning eng arzon yo'li.");

  const edit = await (await post(`/api/media/${brief.id}/edit`, { instructions: 'iliqroq qiling' })).json();
  assert.strictEqual(edit.plan.steps[0], "Xom rasmni ko'rib chiqing va eng kuchli 3-5 soniyani yoki eng yaxshi bitta kadrni belgilang");

  const regenerated = await (await post('/api/brand/generate')).json();
  assert.ok(regenerated.brandBrief.positioning.startsWith('Noir Cafe — '), regenerated.brandBrief.positioning);

  // And an English owner still gets the English template.
  const en = await (await post('/api/media/brief', { kind: 'image', mode: 'guided', topic: 'latte' }, 'en')).json();
  assert.strictEqual(en.brief.tips[0], 'Wipe the lens first — it is the cheapest quality upgrade there is.');
});

test('every sentence the server routes through tr() has an Uzbek translation', () => {
  const dir = path.join(__dirname, '..');
  const files = ['.', 'connectors'].flatMap((d) => fs.readdirSync(path.join(dir, d))
    .filter((f) => f.endsWith('.js')).map((f) => path.join(dir, d, f)));
  const missing = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // Each tr( … ) call, up to its closing parenthesis on the same statement.
    for (const m of src.matchAll(/\btr\(([^;]*?)\)(?=[,;)\s])/g)) {
      for (const lit of m[1].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
        const text = (lit[1] ?? lit[2]).replace(/\\(.)/g, '$1');
        // Sentences only — a bare word like 'Telegram' (or a ' ' separator) is a value, not copy.
        if (!/\s/.test(text) || !/\p{L}/u.test(text)) continue;
        if (!UZ[text]) missing.push(`${path.basename(f)}: ${text}`);
      }
    }
  }
  assert.deepStrictEqual(missing, []);
  assert.strictEqual(i18n.tr('uz', 'Publish {{platform}} Post', { platform: 'Instagram' }), 'Post joylash: Instagram');
});
