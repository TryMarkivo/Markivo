const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// The shared Markivo bot: owners connect by opening a link, pressing Start and
// picking a channel. Env must be set BEFORE requiring the app.
const TMP_DB = path.join(os.tmpdir(), `markivo-tgshared-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_ENABLED = 'true';
const SHARED_TOKEN = '5000000000:SharedMarkivoBotTokenAAAAAAAAAAAAAAAA';
process.env.TELEGRAM_BOT_TOKEN = SHARED_TOKEN;

const BOT = { id: 5000, username: 'markivo_bot', first_name: 'Markivo' };
const OWNER = { id: 777, first_name: 'Dilnoza', language_code: 'uz' };
const STRANGER = { id: 888, first_name: 'Someone', language_code: 'en' };
const CHANNEL = { id: -100900, type: 'channel', title: 'Noir News', username: 'noirnews' };

// Fake api.telegram.org; everything else (the app on localhost) passes through.
const realFetch = global.fetch;
const tgCalls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('api.telegram.org')) return realFetch(url, opts);
  const [, token, method] = /\/bot([^/]+)\/(\w+)$/.exec(u);
  const params = opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
  tgCalls.push({ token, method, params });

  const ok = (result) => ({ status: 200, json: async () => ({ ok: true, result }) });
  if (method === 'getMe') return ok(BOT);
  if (method === 'getChat') return ok(CHANNEL);
  if (method === 'getChatMember') {
    const status = { [BOT.id]: 'administrator', [OWNER.id]: 'creator', [STRANGER.id]: 'member' }[params.user_id] || 'left';
    return ok({ status, can_post_messages: true });
  }
  if (method === 'sendMessage') return ok({ message_id: 1 + tgCalls.length });
  if (method === 'leaveChat') return ok(true);
  return { status: 200, json: async () => ({ ok: false, error_code: 404, description: `unstubbed ${method}` }) };
};

const { app, db } = require('../server');
const hub = require('../telegramHub');

let server, base, owner, stranger;
const ctx = () => ({ db, token: SHARED_TOKEN, me: BOT, log: { warn() {} } });

const post = (p, body, token) =>
  global.fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = async (p, token) => (await global.fetch(base + p, { headers: { Authorization: `Bearer ${token}` } })).json();

async function signUp(name) {
  const reg = await post('/api/auth/register', { email: `${name}${Date.now()}@m.uz`, password: 'secret123', fullName: name });
  const access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: `${name} Cafe`, category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm' }, access);
  return access;
}

const codeOf = (url) => new URL(url).searchParams.get('start');
const privateMsg = (from, extra) => ({ update_id: Date.now(), message: { message_id: 1, from, chat: { id: from.id, type: 'private' }, ...extra } });
const lastReplyTo = (userId) => [...tgCalls].reverse().find((c) => c.method === 'sendMessage' && c.params.chat_id === userId);

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  owner = await signUp('owner');
  stranger = await signUp('stranger');
});
after(() => {
  server.close();
  global.fetch = realFetch;
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('status offers the shared bot before anything is connected', async () => {
  const s = await get('/api/telegram/status', owner);
  assert.strictEqual(s.connected, false);
  assert.strictEqual(s.sharedAvailable, true);
  assert.strictEqual(s.linking, null);
});

let ownerCode;
test('link/start returns a one-time t.me link to the shared bot', async () => {
  const res = await post('/api/telegram/link/start', {}, owner);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.match(data.url, /^https:\/\/t\.me\/markivo_bot\?start=[A-Za-z0-9_-]{16}$/);
  ownerCode = codeOf(data.url);
  const s = await get('/api/telegram/status', owner);
  assert.deepStrictEqual(s.linking, { opened: false });
});

test('an unknown code gets the "expired" reply and binds nothing', async () => {
  const r = await hub.handleUpdate(privateMsg(STRANGER, { text: '/start notarealcode123' }), ctx());
  assert.strictEqual(r, 'expired');
  assert.match(lastReplyTo(STRANGER.id).params.text, /expired/);
});

test('pressing Start binds the Telegram user and shows the channel picker', async () => {
  const r = await hub.handleUpdate(privateMsg(OWNER, { text: `/start ${ownerCode}` }), ctx());
  assert.strictEqual(r, 'started');
  const reply = lastReplyTo(OWNER.id);
  // Uzbek, because the owner's Telegram is in Uzbek.
  assert.match(reply.params.text, /kanalni tanlang/);
  const pick = reply.params.reply_markup.keyboard[0][0].request_chat;
  assert.strictEqual(pick.chat_is_channel, true);
  assert.strictEqual(pick.bot_administrator_rights.can_post_messages, true);
  const s = await get('/api/telegram/status', owner);
  assert.deepStrictEqual(s.linking, { opened: true });
});

test('a user who is not an admin of the channel cannot link it', async () => {
  const res = await post('/api/telegram/link/start', {}, stranger);
  const code = codeOf((await res.json()).url);
  await hub.handleUpdate(privateMsg(STRANGER, { text: `/start ${code}` }), ctx());
  const r = await hub.handleUpdate(privateMsg(STRANGER, { chat_shared: { request_id: 1, chat_id: CHANNEL.id } }), ctx());
  assert.strictEqual(r, 'refused');
  assert.match(lastReplyTo(STRANGER.id).params.text, /Only an admin/);
  assert.strictEqual((await get('/api/telegram/status', stranger)).connected, false);
});

test('picking the channel links it to the owner\'s profile', async () => {
  const r = await hub.handleUpdate(privateMsg(OWNER, { chat_shared: { request_id: 1, chat_id: CHANNEL.id } }), ctx());
  assert.strictEqual(r, 'linked');
  assert.match(lastReplyTo(OWNER.id).params.text, /Noir News/);
  const s = await get('/api/telegram/status', owner);
  assert.strictEqual(s.connected, true);
  assert.strictEqual(s.mode, 'shared');
  assert.strictEqual(s.chat.chatTitle, 'Noir News');
  assert.strictEqual(s.linking, null, 'the one-time link is used up');
});

test('the membership update that arrives alongside is a no-op', async () => {
  const r = await hub.handleUpdate({
    update_id: 2,
    my_chat_member: { chat: CHANNEL, from: OWNER, new_chat_member: { user: BOT, status: 'administrator' } },
  }, ctx());
  assert.strictEqual(r, 'ignored');
  const again = await hub.handleUpdate(privateMsg(OWNER, { chat_shared: { request_id: 1, chat_id: CHANNEL.id } }), ctx());
  assert.strictEqual(again, 'already');
});

test('posts go out through the shared bot token', async () => {
  tgCalls.length = 0;
  const res = await post('/api/telegram/post', { text: 'Hello from the shared bot' }, owner);
  assert.strictEqual(res.status, 200);
  const send = tgCalls.find((c) => c.method === 'sendMessage');
  assert.strictEqual(send.token, SHARED_TOKEN);
  assert.strictEqual(send.params.chat_id, String(CHANNEL.id));
});

test('typing a channel handle or scanning updates is refused for the shared bot', async () => {
  assert.strictEqual((await post('/api/telegram/channel', { chat: '@someoneelse' }, owner)).status, 400);
  assert.strictEqual((await post('/api/telegram/detect-chat', {}, owner)).status, 400);
});

test('the connections list names the channel, not the bot', async () => {
  const s = await get('/api/connect/status', owner);
  assert.strictEqual(s.status.telegram.accountHandle, '@noirnews');
});

test('removing the bot from the channel disconnects the business', async () => {
  const r = await hub.handleUpdate({
    update_id: 3,
    my_chat_member: { chat: CHANNEL, from: OWNER, new_chat_member: { user: BOT, status: 'left' } },
  }, ctx());
  assert.strictEqual(r, 'removed');
  assert.strictEqual((await get('/api/telegram/status', owner)).connected, false);
});

test('adding the bot by hand after pressing Start also links the channel', async () => {
  const res = await post('/api/telegram/link/start', {}, owner);
  await hub.handleUpdate(privateMsg(OWNER, { text: `/start ${codeOf((await res.json()).url)}` }), ctx());
  const r = await hub.handleUpdate({
    update_id: 4,
    my_chat_member: { chat: CHANNEL, from: OWNER, new_chat_member: { user: BOT, status: 'administrator' } },
  }, ctx());
  assert.strictEqual(r, 'linked');
  assert.strictEqual((await get('/api/telegram/status', owner)).chat.chatTitle, 'Noir News');
});

test('disconnecting makes the bot leave a channel no business uses any more', async () => {
  tgCalls.length = 0;
  const res = await post('/api/connect/telegram/disconnect', {}, owner);
  assert.strictEqual(res.status, 200);
  const leave = tgCalls.find((c) => c.method === 'leaveChat');
  assert.strictEqual(leave.params.chat_id, String(CHANNEL.id));
  assert.strictEqual((await get('/api/telegram/status', owner)).connected, false);
});

test('if Telegram refuses the channel picker, the bot sends the add-to-channel link', async () => {
  const res = await post('/api/telegram/link/start', {}, owner);
  const code = codeOf((await res.json()).url);
  const prev = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).endsWith('/sendMessage') && opts.body.includes('request_chat')) {
      return { status: 400, json: async () => ({ ok: false, error_code: 400, description: 'Bad Request: can\'t parse keyboard' }) };
    }
    return prev(url, opts);
  };
  try {
    const r = await hub.handleUpdate(privateMsg(OWNER, { text: `/start ${code}` }), ctx());
    assert.strictEqual(r, 'started');
    const button = lastReplyTo(OWNER.id).params.reply_markup.inline_keyboard[0][0];
    assert.strictEqual(button.url, 'https://t.me/markivo_bot?startchannel&admin=post_messages+edit_messages');
  } finally {
    global.fetch = prev;
  }
});

test('a plain message to the bot explains what it is', async () => {
  const r = await hub.handleUpdate(privateMsg(STRANGER, { text: 'hi' }), ctx());
  assert.strictEqual(r, 'about');
  assert.match(lastReplyTo(STRANGER.id).params.text, /businesses that use Markivo/);
});
