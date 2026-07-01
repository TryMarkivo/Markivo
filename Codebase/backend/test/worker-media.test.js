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
// process. Media stays keyless (route must answer 501 "engine pending").
process.env.TELEGRAM_ENABLED = 'true';
delete process.env.MEDIA_API_KEY;

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

test('video briefs answer 501 coming-soon; unknown media ids answer 404', async () => {
  const brief = await (await post('/api/media/brief', { kind: 'video', mode: 'full', topic: 'cafe tour' }, access)).json();
  const res = await post(`/api/media/${brief.id}/render`, {}, access);
  assert.strictEqual(res.status, 501);
  assert.match((await res.json()).error, /coming soon/);

  const missing = await post('/api/media/nope_123/render', {}, access);
  assert.strictEqual(missing.status, 404);
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

test('renderImage generates via fal.run and saves the image under uploads/', async () => {
  config.mediaApiKey = 'test_fal_key';
  const bytes = Buffer.from('fake-jpeg-bytes-for-test');
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).startsWith('https://fal.run/')) {
      return { status: 200, json: async () => ({ images: [{ url: 'https://cdn.fal.fake/out.png' }] }) };
    }
    return {
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };

  let saved;
  try {
    const { filePath } = await mediagen.renderImage({ prompt: 'cozy cafe hero shot' }, { fetchImpl });
    assert.match(filePath, /^\/uploads\/[0-9a-f-]+\.jpg$/);

    // The generation call carried the key, prompt, and square_hd size.
    assert.strictEqual(calls[0].url, 'https://fal.run/fal-ai/flux/schnell');
    assert.strictEqual(calls[0].opts.headers.Authorization, 'Key test_fal_key');
    assert.deepStrictEqual(JSON.parse(calls[0].opts.body), { prompt: 'cozy cafe hero shot', image_size: 'square_hd' });
    assert.strictEqual(calls[1].url, 'https://cdn.fal.fake/out.png');

    // The downloaded bytes landed on disk under backend/uploads/.
    saved = path.join(__dirname, '..', filePath.replace(/^\//, ''));
    assert.ok(fs.existsSync(saved));
    assert.deepStrictEqual(fs.readFileSync(saved), bytes);
  } finally {
    config.mediaApiKey = '';
    if (saved) { try { fs.unlinkSync(saved); } catch { /* ignore */ } }
  }
});
