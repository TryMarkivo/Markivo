const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-worker-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
// The worker publishes telegram posts for real — turn the flag on for this
// process. Media stays keyless (route must answer 501 "engine pending"), which
// now means no GEMINI_API_KEY: image and video render on the Gemini key.
process.env.TELEGRAM_ENABLED = 'true';
process.env.GEMINI_API_KEY = '';
// Pro so there IS a video allowance to spend — freemium has none, and a 429
// would mask the behaviour these tests are actually about.
process.env.AI_LIMIT_FREEMIUM_VIDEO = '2';

// Selective fetch stub: fake api.telegram.org, pass localhost through.
// sendMessage fails (Bot API error) when the text contains FAILME so the
// worker's failure path is testable.
const realFetch = global.fetch;
const tgCalls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('api.telegram.org')) return realFetch(url, opts);

  const method = u.split('/').pop();
  const params = opts?.body ? JSON.parse(opts.body) : {};
  tgCalls.push({ method, params });

  if (method === 'sendMessage' && String(params.text).includes('FAILME')) {
    return { status: 200, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }) };
  }
  const responses = {
    getMe: { ok: true, result: { id: 42, username: 'noir_assistant_bot', first_name: 'Noir Assistant' } },
    setMyName: { ok: true, result: true },
    setMyDescription: { ok: true, result: true },
    setMyShortDescription: { ok: true, result: true },
    setMyCommands: { ok: true, result: true },
    getChat: { ok: true, result: { id: -100555, type: 'channel', title: 'Noir News' } },
    getChatMember: { ok: true, result: { status: 'administrator', can_post_messages: true } },
    getChatMemberCount: { ok: true, result: 1234 },
    sendMessage: { ok: true, result: { message_id: 2001 } },
    getUpdates: {
      ok: true,
      result: [{
        update_id: 1,
        my_chat_member: {
          chat: { id: -100555, type: 'channel', title: 'Noir News' },
          new_chat_member: { user: { id: 42 }, status: 'administrator' },
        },
      }],
    },
  };
  const body = responses[method] || { ok: false, error_code: 404, description: `unstubbed ${method}` };
  return { status: 200, json: async () => body };
};

const { app, runScheduledPostsTick } = require('../server');
const mediagen = require('../mediagen');
const config = require('../config');

const sendCount = () => tgCalls.filter((c) => c.method === 'sendMessage').length;

let server, base, access;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Register + onboard a business, then link the telegram bot + channel.
  const reg = await post('/api/auth/register', { email: `wk${Date.now()}@m.uz`, password: 'secret123', fullName: 'Worker Owner' });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm',
  }, access);
  await post('/api/telegram/connect', { botToken: '1234567890:AAFakeTokenAAAAAAAAAAAAAAAAAAAAAAAA' }, access);
  await post('/api/telegram/detect-chat', {}, access);
});
after(() => {
  server.close();
  global.fetch = realFetch;
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

const post = (p, body, token) =>
  global.fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) => global.fetch(base + p, { headers: { Authorization: `Bearer ${token}` } });
const calendar = async () => (await (await get('/api/content/calendar', access)).json());

// ---------------------------------------------------------------------------
// Scheduled-post worker
// ---------------------------------------------------------------------------

test('worker tick publishes a due telegram post and leaves other platforms scheduled', async () => {
  const past = new Date(Date.now() - 60000).toISOString();
  const tgPost = await (await post('/api/content/schedule', {
    platform: 'telegram', postText: 'Weekend honey cake — 20% off!', scheduledTime: past,
  }, access)).json();
  const igPost = await (await post('/api/content/schedule', {
    platform: 'instagram', postText: 'Past-due insta post', scheduledTime: past,
  }, access)).json();

  const sendsBefore = sendCount();
  const result = await runScheduledPostsTick();
  assert.strictEqual(result.posted, 1);
  assert.strictEqual(result.failed, 0);

  // Exactly ONE real send, to the linked channel, with the row's text.
  assert.strictEqual(sendCount() - sendsBefore, 1);
  const sent = tgCalls.filter((c) => c.method === 'sendMessage').pop();
  assert.strictEqual(sent.params.chat_id, '-100555');
  assert.match(sent.params.text, /honey cake/);

  // The SAME row flipped to posted (no duplicate calendar entry was created).
  const cal = await calendar();
  assert.strictEqual(cal.filter((p) => /honey cake/.test(p.post_text)).length, 1);
  assert.strictEqual(cal.find((p) => p.id === tgPost.id).status, 'posted');
  // The due instagram row stays scheduled — that integration is pending.
  assert.strictEqual(cal.find((p) => p.id === igPost.id).status, 'scheduled');

  // A second tick is idempotent: nothing left due, nothing re-sent.
  const again = await runScheduledPostsTick();
  assert.strictEqual(again.posted, 0);
  assert.strictEqual(sendCount() - sendsBefore, 1);
});

test('worker tick marks a failing telegram send as failed and does not retry it', async () => {
  const past = new Date(Date.now() - 60000).toISOString();
  const row = await (await post('/api/content/schedule', {
    platform: 'telegram', postText: 'FAILME please', scheduledTime: past,
  }, access)).json();

  const sendsBefore = sendCount();
  const result = await runScheduledPostsTick();
  assert.strictEqual(result.failed, 1);
  assert.strictEqual((await calendar()).find((p) => p.id === row.id).status, 'failed');

  // Failed rows are not retried on the next tick.
  await runScheduledPostsTick();
  assert.strictEqual(sendCount() - sendsBefore, 1);
});

// ---------------------------------------------------------------------------
// Media rendering route
// ---------------------------------------------------------------------------

test('render answers 501 engine-pending in keyless mode', async () => {
  const brief = await (await post('/api/media/brief', { kind: 'image', mode: 'full', topic: 'honey cake launch' }, access)).json();
  assert.ok(brief.id);

  const res = await post(`/api/media/${brief.id}/render`, {}, access);
  assert.strictEqual(res.status, 501);
  assert.match((await res.json()).error, /Media engine pending/);
});

test('video renders reach the engine too — 501 keyless, not "coming soon"', async () => {
  const brief = await (await post('/api/media/brief', { kind: 'video', mode: 'full', topic: 'cafe tour' }, access)).json();
  const res = await post(`/api/media/${brief.id}/render`, {}, access);
  assert.strictEqual(res.status, 501);
  assert.match((await res.json()).error, /Media engine pending/);

  const missing = await post('/api/media/nope_123/render', {}, access);
  assert.strictEqual(missing.status, 404);
});

test('a keyless video render charges nothing — the spend never happened', async () => {
  const usage = await (await fetch(`${base}/api/usage`, { headers: { Authorization: `Bearer ${access}` } })).json();
  assert.strictEqual(usage.buckets.video.used, 0);
});

// ---------------------------------------------------------------------------
// mediagen.renderImage unit
// ---------------------------------------------------------------------------

test('renderImage throws MediaEngineError 501 without a key', async () => {
  await assert.rejects(
    mediagen.renderImage({ prompt: 'a latte' }),
    (err) => err instanceof mediagen.MediaEngineError && err.status === 501
  );
});

test('renderImage posts to the Gemini image API and saves the returned bytes', async () => {
  config.geminiApiKey = 'test_gemini_key';
  const bytes = Buffer.from('fake-jpeg-bytes-for-test');
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return {
      status: 200,
      json: async () => ({ output_image: { data: bytes.toString('base64'), mime_type: 'image/jpeg' } }),
    };
  };

  let saved;
  try {
    const { filePath } = await mediagen.renderImage({ prompt: 'cozy cafe hero shot' }, { fetchImpl });
    assert.match(filePath, /^\/uploads\/[0-9a-f-]+\.jpg$/);

    // One call, not two: the image comes back inline as base64, so unlike the
    // old provider there is no second download hop.
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.strictEqual(calls[0].opts.headers['x-goog-api-key'], 'test_gemini_key');
    const body = JSON.parse(calls[0].opts.body);
    assert.strictEqual(body.model, config.geminiImageModel);
    assert.deepStrictEqual(body.input, [{ type: 'text', text: 'cozy cafe hero shot' }]);
    assert.strictEqual(body.response_format.type, 'image');

    saved = path.join(__dirname, '..', filePath.replace(/^\//, ''));
    assert.ok(fs.existsSync(saved));
    assert.deepStrictEqual(fs.readFileSync(saved), bytes);
  } finally {
    config.geminiApiKey = '';
    if (saved) { try { fs.unlinkSync(saved); } catch { /* ignore */ } }
  }
});

test('editImage sends the source image alongside the instruction', async () => {
  config.geminiApiKey = 'test_gemini_key';
  const src = Buffer.from('original-image-bytes');
  const uploads = path.join(__dirname, '..', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  const srcName = `edit-src-${Date.now()}.jpg`;
  fs.writeFileSync(path.join(uploads, srcName), src);

  let saved;
  try {
    let body;
    const fetchImpl = async (url, opts) => {
      body = JSON.parse(opts.body);
      return { status: 200, json: async () => ({ output_image: { data: Buffer.from('edited').toString('base64'), mime_type: 'image/jpeg' } }) };
    };
    const { filePath } = await mediagen.editImage({ prompt: 'warmer light', filePath: `uploads/${srcName}` }, { fetchImpl });

    assert.strictEqual(body.input.length, 2, 'text instruction plus the image being edited');
    assert.strictEqual(body.input[1].type, 'image');
    assert.strictEqual(body.input[1].data, src.toString('base64'));

    saved = path.join(__dirname, '..', filePath.replace(/^\//, ''));
    assert.notStrictEqual(path.basename(saved), srcName, 'the edit is a NEW file, not an overwrite');
    assert.ok(fs.existsSync(path.join(uploads, srcName)), 'the original survives the edit');
  } finally {
    config.geminiApiKey = '';
    try { fs.unlinkSync(path.join(uploads, srcName)); } catch { /* ignore */ }
    if (saved) { try { fs.unlinkSync(saved); } catch { /* ignore */ } }
  }
});

test('editImage refuses when the source file is gone', async () => {
  config.geminiApiKey = 'test_gemini_key';
  try {
    await assert.rejects(
      mediagen.editImage({ prompt: 'x', filePath: 'uploads/does-not-exist.jpg' }),
      (err) => err instanceof mediagen.MediaEngineError && err.status === 404
    );
  } finally {
    config.geminiApiKey = '';
  }
});

test('startVideo submits a long-running operation and returns its handle', async () => {
  config.geminiApiKey = 'test_gemini_key';
  try {
    let call;
    const fetchImpl = async (url, opts) => {
      call = { url: String(url), body: JSON.parse(opts.body) };
      return { status: 200, json: async () => ({ name: 'operations/abc123' }) };
    };
    const { operationId } = await mediagen.startVideo({ prompt: 'a slow pan across the counter' }, { fetchImpl });

    assert.strictEqual(operationId, 'operations/abc123');
    assert.match(call.url, /:predictLongRunning$/);
    assert.ok(call.url.includes(encodeURIComponent(config.veoModel)));
    assert.strictEqual(call.body.instances[0].prompt, 'a slow pan across the counter');
    // Duration and resolution are the cost dials, so they must actually be sent.
    assert.strictEqual(call.body.parameters.durationSeconds, config.veoDurationSeconds);
    assert.strictEqual(call.body.parameters.resolution, config.veoResolution);
  } finally {
    config.geminiApiKey = '';
  }
});

test('pollVideo distinguishes pending, failed, and finished jobs', async () => {
  config.geminiApiKey = 'test_gemini_key';
  try {
    const withResponse = (payload) => async () => ({ status: 200, json: async () => payload });

    assert.deepStrictEqual(
      await mediagen.pollVideo({ operationId: 'operations/x' }, { fetchImpl: withResponse({ done: false }) }),
      { done: false }
    );

    const failed = await mediagen.pollVideo(
      { operationId: 'operations/x' },
      { fetchImpl: withResponse({ done: true, error: { message: 'safety filter' } }) }
    );
    assert.strictEqual(failed.done, true);
    assert.match(failed.error, /safety filter/);

    const ok = await mediagen.pollVideo(
      { operationId: 'operations/x' },
      { fetchImpl: withResponse({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://v/out.mp4' } }] } } }) }
    );
    assert.deepStrictEqual(ok, { done: true, uri: 'https://v/out.mp4' });

    // Done, but nothing produced — terminal and refundable, not a silent pass.
    const empty = await mediagen.pollVideo(
      { operationId: 'operations/x' },
      { fetchImpl: withResponse({ done: true, response: {} }) }
    );
    assert.strictEqual(empty.done, true);
    assert.ok(empty.error);
  } finally {
    config.geminiApiKey = '';
  }
});
