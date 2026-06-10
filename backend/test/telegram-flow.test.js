const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
const TMP_DB = path.join(os.tmpdir(), `markivo-tgflow-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

// Selective fetch stub: fake api.telegram.org, pass localhost through.
const realFetch = global.fetch;
const tgCalls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('api.telegram.org')) return realFetch(url, opts);

  const method = u.split('/').pop();
  const params = opts?.body ? JSON.parse(opts.body) : {};
  tgCalls.push({ method, params });

  const responses = {
    getMe: { ok: true, result: { id: 42, username: 'noir_assistant_bot', first_name: 'Noir Assistant' } },
    setMyName: { ok: true, result: true },
    setMyDescription: { ok: true, result: true },
    setMyShortDescription: { ok: true, result: true },
    setMyCommands: { ok: true, result: true },
    getChat: { ok: true, result: { id: -100555, type: 'channel', title: 'Noir News' } },
    getChatMember: { ok: true, result: { status: 'administrator', can_post_messages: true } },
    sendMessage: { ok: true, result: { message_id: 1001 } },
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

const { app } = require('../server');

let server, base, access;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // Register + onboard a business.
  const reg = await post('/api/auth/register', { email: `tg${Date.now()}@m.uz`, password: 'secret123', fullName: 'TG Owner' });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', {
    businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm', slogan: 'Simplicity, refined.',
  }, access);
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

test('connect rejects malformed tokens without calling Telegram', async () => {
  const res = await post('/api/telegram/connect', { botToken: 'garbage' }, access);
  assert.strictEqual(res.status, 400);
  assert.strictEqual(tgCalls.length, 0);
});

test('connect validates the token and auto-brands the bot', async () => {
  const res = await post('/api/telegram/connect', { botToken: '1234567890:AAFakeTokenAAAAAAAAAAAAAAAAAAAAAAAA' }, access);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.botUsername, 'noir_assistant_bot');
  assert.strictEqual(data.branding.description, true);
  // Branding used real business details.
  const desc = tgCalls.find((c) => c.method === 'setMyDescription');
  assert.match(desc.params.description, /Noir Cafe/);
});

test('detect-chat finds and verifies the channel', async () => {
  const res = await post('/api/telegram/detect-chat', {}, access);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.chat.chatTitle, 'Noir News');
});

test('status reflects the full connection', async () => {
  const data = await (await get('/api/telegram/status', access)).json();
  assert.strictEqual(data.connected, true);
  assert.strictEqual(data.botUsername, 'noir_assistant_bot');
  assert.strictEqual(data.chat.chatTitle, 'Noir News');
});

test('Markiv drafts a telegram post behind the approval gate, approve publishes it', async () => {
  // 1. Ask Markiv to post (AI disabled in tests → keyword fallback path).
  const q = await post('/api/agent/query', { query: 'Please post our weekend honey cake discount to telegram' }, access);
  assert.strictEqual(q.status, 200);
  const action = await q.json();
  assert.strictEqual(action.triggerApproval, true);
  assert.ok(action.approvalId);
  assert.strictEqual(action.payload.action, 'Publish Telegram Post');
  assert.ok(action.payload.creative.length > 0);

  // 2. Nothing was sent yet — approval gate holds.
  assert.strictEqual(tgCalls.filter((c) => c.method === 'sendMessage').length, 0);

  // 3. Approve → real (stubbed) Bot API send.
  const ap = await post('/api/agent/approve', { approvalId: action.approvalId }, access);
  assert.strictEqual(ap.status, 200);
  const result = await ap.json();
  assert.match(result.message, /Published to Noir News/);

  const sends = tgCalls.filter((c) => c.method === 'sendMessage');
  assert.strictEqual(sends.length, 1);
  assert.strictEqual(sends[0].params.chat_id, '-100555');

  // 4. The post landed on the content calendar as posted.
  const cal = await (await get('/api/content/calendar', access)).json();
  assert.ok(cal.some((p) => p.platform === 'telegram' && p.status === 'posted'));

  // 5. Replaying the same approval is rejected.
  const replay = await post('/api/agent/approve', { approvalId: action.approvalId }, access);
  assert.strictEqual(replay.status, 400);
});

test('direct /api/telegram/post publishes immediately', async () => {
  const res = await post('/api/telegram/post', { text: 'Direct hello!' }, access);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.chatTitle, 'Noir News');
});
