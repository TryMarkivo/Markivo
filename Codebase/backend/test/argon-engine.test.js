const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Set env BEFORE requiring the app — config caches env at load. A fake Gemini
// key makes Argon the live engine; every call to Google is answered by the
// stub below, never the network.
const TMP_DB = path.join(os.tmpdir(), `markivo-argon-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = 'fake_test_key_123';
process.env.GEMINI_TEXT_MODEL = '';
process.env.GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';
process.env.AI_LIMIT_FREEMIUM_WRITING = '30';
process.env.AI_LIMIT_FREEMIUM_IMAGE = '5';

// Each test installs `onGemini(body)` to answer the Interactions calls it
// cares about. Anything unanswered fails like a dropped connection, so the
// app's own fallbacks (templates) handle the calls a test is not about.
const realFetch = global.fetch;
let onGemini = null;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, opts);
  const answer = onGemini && onGemini(JSON.parse(opts.body), u);
  if (!answer) throw new TypeError('fetch failed');
  return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
};

const completed = (text) => ({
  status: 200,
  body: { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] },
});

const config = require('../config');
const gemini = require('../gemini');
const mediagen = require('../mediagen');
const businessContext = require('../businessContextService');
const createDb = require('../db');
const { app } = require('../server');

// A 1x1 PNG — the smallest thing /api/media/upload accepts.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server, base, access, db, profileId;
const send = (method) => (p, body) =>
  realFetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    body: JSON.stringify(body || {}),
  });
const post = send('POST');
const put = send('PUT');

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  db = createDb(config.dbPath);
  const reg = await post('/api/auth/register', { email: `argon${Date.now()}@m.uz`, password: 'secret123', fullName: 'Argon Owner' });
  access = (await reg.json()).accessToken;
  const construct = await (await post('/api/onboarding/construct', { businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop' })).json();
  profileId = (construct.profile || construct).id;
});

after(() => {
  onGemini = null;
  global.fetch = realFetch;
  db.close();
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

test('Argon is the default text engine', () => {
  assert.strictEqual(config.geminiTextModel, 'gemini-4-argon');
  assert.strictEqual(config.textEngine, 'gemini');
});

test('a JSON completion is one stateless Interactions call to Argon', async () => {
  const seen = [];
  onGemini = (body, url) => {
    if (body.input !== 'probe-1') return null;
    seen.push({ body, url });
    return completed('{"slogans":["a","b","c"]}');
  };
  const out = await gemini.callGeminiJSON({
    system: 'be brief',
    prompt: 'probe-1',
    schema: { type: 'object', properties: { slogans: { type: 'array', items: { type: 'string' } } }, required: ['slogans'], additionalProperties: false },
    maxTokens: 400,
  });
  assert.deepStrictEqual(out, { slogans: ['a', 'b', 'c'] });

  assert.strictEqual(seen.length, 1);
  const { body, url } = seen[0];
  assert.strictEqual(url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.strictEqual(body.model, 'gemini-4-argon');
  assert.strictEqual(body.store, false);
  assert.strictEqual(body.system_instruction, 'be brief');
  assert.strictEqual(body.generation_config.thinking_level, 'low');
  assert.ok(body.generation_config.max_output_tokens > 400, 'thinking gets headroom on top of the answer budget');
  assert.strictEqual(body.generation_config.temperature, undefined, 'sampling params are ignored by Argon');
  assert.deepStrictEqual(body.response_format, {
    type: 'text',
    mime_type: 'application/json',
    schema: { type: 'object', properties: { slogans: { type: 'array', items: { type: 'string' } } }, required: ['slogans'] },
  });
});

test('a call Argon refuses is retried once on the fallback model', async () => {
  const models = [];
  onGemini = (body) => {
    if (body.input !== 'probe-2') return null;
    models.push(body.model);
    return body.model === 'gemini-4-argon'
      ? { status: 429, body: { error: { message: 'Quota exceeded: limit 0 on the free tier' } } }
      : completed('{"ok":true}');
  };
  const out = await gemini.callGeminiJSON({ prompt: 'probe-2', schema: { type: 'object', properties: { ok: { type: 'boolean' } } } });
  assert.deepStrictEqual(out, { ok: true });
  assert.deepStrictEqual(models, ['gemini-4-argon', 'gemini-flash-latest']);
});

test('a dropped connection is not retried — a second attempt would only double the wait', async () => {
  let calls = 0;
  onGemini = (body) => {
    if (body.input === 'probe-3') calls += 1;
    return null; // the stub turns this into a network failure
  };
  await assert.rejects(gemini.callGeminiJSON({ prompt: 'probe-3', schema: { type: 'object', properties: {} } }), /unreachable/);
  assert.strictEqual(calls, 1);
});

test('business questions reach the model again (previously a swallowed ReferenceError)', async () => {
  onGemini = (body) => (String(body.input).includes('Bakehouse')
    ? completed(JSON.stringify({ questions: [{ key: 'signature_bake', label: 'Signature bake?', hint: '', placeholder: '', type: 'text' }] }))
    : null);
  const qs = await gemini.businessQuestions({ name: 'Bakehouse', category: 'Bakery' });
  assert.ok(Array.isArray(qs), 'questions come back instead of null');
  assert.strictEqual(qs[0].key, 'signature_bake');
});

// ---------------------------------------------------------------------------
// Media: Argon art-directs, the image model renders
// ---------------------------------------------------------------------------

test('a full-mode ad brief is written from the owner\'s own prompt, and the render uses it', async () => {
  const ask = 'Summer sale: 20% off all iced lattes this weekend';
  let briefRequest;
  onGemini = (body) => {
    if (!String(body.input).includes(ask)) return null;
    briefRequest = body;
    return completed(JSON.stringify({
      concept: 'An iced latte sweating in the sun, sale banner across the top.',
      headline: '20% off iced lattes',
      caption: 'This weekend only ☀️ #noircafe',
      visualSpec: { composition: 'hero glass centre', palette: 'cream and espresso', mood: 'sunny' },
      renderPrompt: 'Photoreal ad: a tall iced latte on a marble counter, headline "20% off iced lattes" in bold serif at top.',
    }));
  };

  const res = await post('/api/media/brief', { kind: 'image', mode: 'full', topic: ask });
  assert.strictEqual(res.status, 200);
  const { id, brief } = await res.json();

  assert.ok(briefRequest, 'the brief went to the model');
  assert.strictEqual(briefRequest.model, 'gemini-4-argon');
  assert.match(briefRequest.input, /OWNER'S PROMPT/);
  assert.ok(briefRequest.response_format.schema.required.includes('renderPrompt'));
  assert.strictEqual(brief.headline, '20% off iced lattes');
  assert.strictEqual(brief.engineStatus, 'ready');
  assert.strictEqual(brief.note, undefined, 'no "engine pending" note on a live engine');

  let renderPrompt;
  const original = mediagen.renderImage;
  mediagen.renderImage = async ({ prompt }) => {
    renderPrompt = prompt;
    return { filePath: '/uploads/argon-test.jpg' };
  };
  try {
    const render = await post(`/api/media/${id}/render`);
    assert.strictEqual(render.status, 200);
  } finally {
    mediagen.renderImage = original;
  }
  assert.ok(renderPrompt.startsWith('Photoreal ad: a tall iced latte'), 'Argon\'s render prompt goes to the engine as-is');
  assert.ok(renderPrompt.includes(`OWNER'S REQUEST (must be reflected exactly): ${ask}`), 'the owner\'s own words always ride along');
});

test('an image edit sends Argon\'s directed instruction to the image model', async () => {
  const up = await post('/api/media/upload', { filename: 'shot.png', dataUrl: PNG_DATA_URL });
  const { id } = await up.json();

  onGemini = (body) => (String(body.input).includes('make the background red')
    ? completed('Change only the background to a deep red; keep the cup, lighting and framing unchanged.')
    : null);

  let editPrompt;
  const original = mediagen.editImage;
  mediagen.editImage = async ({ prompt }) => {
    editPrompt = prompt;
    return { filePath: '/uploads/argon-edit.jpg' };
  };
  try {
    const res = await post(`/api/media/${id}/apply-edit`, { instructions: 'make the background red' });
    assert.strictEqual(res.status, 200);
  } finally {
    mediagen.editImage = original;
  }
  assert.ok(editPrompt.startsWith('Change only the background to a deep red'));
});

test('renderImage reads the image out of the REST steps', async () => {
  const bytes = Buffer.from('jpeg-from-steps');
  let body;
  const fetchImpl = async (url, opts) => {
    body = JSON.parse(opts.body);
    return {
      status: 200,
      json: async () => ({
        status: 'completed',
        steps: [{ type: 'model_output', content: [
          { type: 'text', text: 'Here is your ad.' },
          { type: 'image', mime_type: 'image/jpeg', data: bytes.toString('base64') },
        ] }],
      }),
    };
  };

  const { filePath } = await mediagen.renderImage({ prompt: 'an ad' }, { fetchImpl });
  const saved = path.join(__dirname, '..', filePath.replace(/^\//, ''));
  try {
    assert.deepStrictEqual(fs.readFileSync(saved), bytes);
    // Verified live: the image models answer 400 to a `delivery` field.
    assert.strictEqual(body.response_format.delivery, undefined);
    assert.strictEqual(body.store, false);
  } finally {
    try { fs.unlinkSync(saved); } catch { /* ignore */ }
  }
});

test('renderImage surfaces the model\'s refusal instead of a bare "no image"', async () => {
  const fetchImpl = async () => ({
    status: 200,
    json: async () => ({
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I can\'t create images of that person.' }] }],
    }),
  });
  await assert.rejects(
    mediagen.renderImage({ prompt: 'x' }, { fetchImpl }),
    (err) => err instanceof mediagen.MediaEngineError && err.status === 502 && /can't create images/.test(err.message)
  );
});

// ---------------------------------------------------------------------------
// Business memory: every generator gets everything known about the business,
// and the memory re-learns the business when the owner tells us something new
// ---------------------------------------------------------------------------

const isDistil = (body) => String(body.system_instruction || '').startsWith('You distil a small business');

// The refresh is fire-and-forget from the routes, so a test waits for its
// effect on the stored cell rather than for the request.
async function cellMatching(pattern, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const cell = db.businessContext.get(profileId);
    if (cell && pattern.test(cell.summary)) return cell;
    await new Promise((r) => setTimeout(r, 25));
  }
  return db.businessContext.get(profileId);
}

test('telling Markivo a new fact re-learns the business in the background', async () => {
  const seen = [];
  onGemini = (body) => {
    if (!isDistil(body)) return null;
    seen.push(body.input);
    return completed(JSON.stringify({
      summary: 'Noir Cafe is a specialty coffee bar serving breakfast until noon.',
      tone: 'calm, modern', audience: 'students and remote workers', sellingPoints: ['breakfast until noon'],
    }));
  };

  const res = await put('/api/brand', { businessFacts: { hours: 'Breakfast until noon, open 8:00-22:00' } });
  assert.strictEqual(res.status, 200);

  const cell = await cellMatching(/breakfast until noon/);
  assert.match(cell.summary, /breakfast until noon/, 'the stored memory now carries the new fact');
  assert.match(seen[0], /Breakfast until noon, open 8:00-22:00/, 'the owner\'s own fact went into the re-distillation');
});

test('a failed refresh keeps the existing memory instead of overwriting it', async () => {
  const before = db.businessContext.get(profileId).summary;
  onGemini = (body) => (isDistil(body) ? { status: 500, body: { error: { message: 'backend error' } } } : null);
  const cell = await businessContext.refreshBusinessContext(db, profileId);
  assert.strictEqual(cell, null);
  assert.strictEqual(db.businessContext.get(profileId).summary, before);
});

test('a burst of saves is coalesced into at most two refreshes', async () => {
  let calls = 0;
  onGemini = (body) => {
    if (!isDistil(body)) return null;
    calls += 1;
    return completed(JSON.stringify({ summary: `pass ${calls}`, tone: 't', audience: 'a', sellingPoints: [] }));
  };
  await Promise.all([1, 2, 3, 4].map(() => businessContext.refreshBusinessContext(db, profileId)));
  assert.strictEqual(calls, 2, 'one pass for the first save, one more that sees the rest');
});

test('post copy is written from the whole business memory, to a professional standard', async () => {
  db.feedback.record({ profileId, platform: 'instagram', signal: 'approved', finalText: 'Cold brew season is open — come taste it on the terrace.' });
  db.businessContext.upsert({
    profileId, summary: 'Noir Cafe is a specialty coffee bar near Amir Temur square.',
    tone: 'calm, modern', audience: 'students', sellingPoints: ['single-origin espresso'], source: 'gemini',
  });

  let request;
  onGemini = (body) => {
    if (!String(body.input).includes('Post topic: weekend breakfast')) return null;
    request = body;
    return completed(JSON.stringify({ post: 'Breakfast runs until noon this weekend.', mediaTip: 'tip', hashtags: ['#noircafe'] }));
  };
  const res = await post('/api/content/copywrite', { platform: 'instagram', topic: 'weekend breakfast' });
  assert.strictEqual(res.status, 200);
  assert.ok(request, 'the copy went to the model');

  const input = String(request.input);
  assert.match(input, /BUSINESS CONTEXT/, 'the stored context cell');
  assert.match(input, /single-origin espresso/);
  assert.match(input, /Breakfast until noon, open 8:00-22:00/, 'the owner\'s facts');
  assert.match(input, /Cold brew season is open/, 'what the owner actually published');
  assert.match(input, /20% off iced lattes/, 'the ads already made');
  assert.match(input, /PLATFORM RULES/);
  assert.match(request.system_instruction, /senior social-media copywriter/);
  assert.match(request.system_instruction, /Never use these clichés: "something special"/);
});

test('the memory is per business — another owner\'s facts never reach this prompt', async () => {
  const other = await (await realFetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `other${Date.now()}@m.uz`, password: 'secret123', fullName: 'Other' }),
  })).json();
  const otherProfile = (await (await realFetch(`${base}/api/onboarding/construct`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other.accessToken}` },
    body: JSON.stringify({ businessName: 'Tash Barbers', category: 'Barbershop' }),
  })).json()).profile;

  const mine = businessContext.memoryDigest(db, db.profiles.findById(profileId));
  const theirs = businessContext.memoryDigest(db, db.profiles.findById(otherProfile.id));
  assert.match(mine, /Noir Cafe/);
  assert.doesNotMatch(mine, /Tash Barbers/);
  assert.doesNotMatch(theirs, /Noir Cafe|Breakfast until noon|Cold brew/);
});
