// Autopilot through the shared Markivo bot: the bot saves every new channel
// post and every post the owner forwards (so Autopilot learns even a private
// channel), sends the owner posts waiting for their OK with Post / Skip
// buttons, and only the owner can press them.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `markivo-aptg-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AUTONOMOUS_ENABLED = 'true';
process.env.TELEGRAM_ENABLED = 'true';
process.env.APP_URL = 'https://app.markivo.test';
// These tests cover learning from every source (the channel too).
process.env.AUTOPILOT_LEARN_FROM = 'all';
const SHARED_TOKEN = '5000000000:SharedMarkivoBotTokenAAAAAAAAAAAAAAAA';
process.env.TELEGRAM_BOT_TOKEN = SHARED_TOKEN;

const BOT = { id: 5000, username: 'markivo_bot', first_name: 'Markivo' };
const OWNER = { id: 777, first_name: 'Dilnoza', language_code: 'uz' };
const STRANGER = { id: 888, first_name: 'Someone', language_code: 'en' };
const CHANNEL = { id: -100900, type: 'channel', title: 'Noir News', username: 'noirnews' };

const realFetch = global.fetch;
const tgCalls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('api.telegram.org')) return realFetch(url, opts);
  const [, , method] = /\/bot([^/]+)\/(\w+)$/.exec(u);
  const params = opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
  tgCalls.push({ method, params });
  const ok = (result) => ({ status: 200, json: async () => ({ ok: true, result }) });
  if (method === 'sendMessage') return ok({ message_id: 1000 + tgCalls.length });
  if (['answerCallbackQuery', 'editMessageReplyMarkup'].includes(method)) return ok(true);
  return { status: 200, json: async () => ({ ok: false, error_code: 404, description: `unstubbed ${method}` }) };
};

const { app, db, telegramBotActions, autopilotPublishers } = require('../server');
const hub = require('../telegramHub');

let server, base, profileId, otherProfileId;
const ctx = () => ({ db, token: SHARED_TOKEN, me: BOT, log: { warn() {} }, actions: telegramBotActions });
const post = (p, body, token) => realFetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

async function signUp(name) {
  const reg = await post('/api/auth/register', { email: `${name}${Date.now()}@m.uz`, password: 'secret123', fullName: name, preferredLang: 'uz' });
  const access = (await reg.json()).accessToken;
  const onb = await post('/api/onboarding/construct', { businessName: `${name} Cafe`, category: 'Cafe' }, access);
  return (await onb.json()).profile.id;
}

const channelPost = (id, text, extra = {}) => ({ update_id: id, channel_post: { message_id: id, chat: CHANNEL, date: 1790000000 + id, text, ...extra } });
const privateMsg = (from, extra) => ({ update_id: Date.now(), message: { message_id: 1, from, chat: { id: from.id, type: 'private' }, date: 1790000000, ...extra } });
const lastSendTo = (chatId) => [...tgCalls].reverse().find((c) => c.method === 'sendMessage' && c.params.chat_id === chatId);

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  profileId = await signUp('owner');
  otherProfileId = await signUp('other');
  db.telegram.upsertShared({
    profileId, botUserId: BOT.id, botUsername: BOT.username, ownerTgUserId: OWNER.id,
    chat: { chatId: String(CHANNEL.id), chatTitle: CHANNEL.title, chatType: 'channel', chatUsername: CHANNEL.username },
  });
});
after(() => {
  server.close();
  global.fetch = realFetch;
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('a new post in the linked channel is saved for Autopilot to learn from; an edit updates it', async () => {
  assert.equal(await hub.handleUpdate(channelPost(55, 'Yangi menyu: lavash va burger!'), ctx()), 'learned');
  let rows = db.ownContent.listByProfile(profileId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].externalId, '55');
  assert.equal(rows[0].source, 'bot');
  await hub.handleUpdate({ update_id: 56, edited_channel_post: { message_id: 55, chat: CHANNEL, date: 1790000055, text: 'Yangi menyu: lavash, burger va kofe!' } }, ctx());
  rows = db.ownContent.listByProfile(profileId);
  assert.equal(rows.length, 1, 'same message, same row');
  assert.match(rows[0].caption, /kofe/);
  // A channel nobody linked, or a post without text: nothing saved.
  assert.equal(await hub.handleUpdate({ update_id: 57, channel_post: { message_id: 1, chat: { id: -1, type: 'channel' }, date: 1, text: 'x' } }, ctx()), 'ignored');
  assert.equal(await hub.handleUpdate(channelPost(58, undefined, { photo: [{}] }), ctx()), 'ignored');
});

test('the owner forwards posts to the bot: Autopilot learns from them', async () => {
  // From the linked channel: merges with the row the bot already saved.
  const fromChannel = await hub.handleUpdate(privateMsg(OWNER, {
    text: 'Yangi menyu: lavash, burger va kofe!',
    forward_origin: { type: 'channel', chat: CHANNEL, message_id: 55, date: 1790000055 },
  }), ctx());
  assert.equal(fromChannel, 'learned');
  assert.equal(db.ownContent.listByProfile(profileId).length, 1);
  // From another channel of theirs: a new example.
  await hub.handleUpdate(privateMsg(OWNER, {
    text: 'Eski kanalimizdagi eng yaxshi post',
    forward_origin: { type: 'channel', chat: { id: -100111, type: 'channel', title: 'Old' }, message_id: 9, date: 1700000000 },
  }), ctx());
  const rows = db.ownContent.listByProfile(profileId);
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => r.externalId === 'fwd:-100111:9' && r.source === 'forwarded'));
  assert.match(lastSendTo(OWNER.id).params.text, /o‘rganadi \(jami 2 ta post\)/, 'answered in the owner\'s language');

  // Someone who linked nothing is told to connect first; nothing is saved.
  const stranger = await hub.handleUpdate(privateMsg(STRANGER, {
    text: 'hello', forward_origin: { type: 'channel', chat: CHANNEL, message_id: 56, date: 1790000056 },
  }), ctx());
  assert.equal(stranger, 'unlinked');
  assert.match(lastSendTo(STRANGER.id).params.text, /Connect your channel first/);
});

function queueApproval(scheduledFor) {
  return db.approvals.create({
    profileId,
    actionType: 'telegram_post',
    actionPayload: { action: 'Publish Telegram Post', cost: 'Free — organic post', target: CHANNEL.title, creative: 'Bugun jonli musiqa!', text: 'Bugun jonli musiqa!', autonomous: true, scheduledFor },
  });
}

test('the owner gets the post with Post / Skip buttons, in their Markivo language', async () => {
  const slot = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const approval = queueApproval(slot);
  await autopilotPublishers.notifyOwner('approval', db.profiles.findById(profileId), { approval, timezone: 'Asia/Tashkent' });
  const msg = lastSendTo(OWNER.id);
  assert.match(msg.params.text, /Autopilot «Noir News» uchun post yozdi — .* da chiqadi:\n\nBugun jonli musiqa!/);
  const [row1, row2] = msg.params.reply_markup.inline_keyboard;
  assert.deepEqual(row1.map((b) => b.callback_data), [`apv:${approval.id}:y`, `apv:${approval.id}:n`]);
  assert.equal(row2[0].url, 'https://app.markivo.test/?tab=autopilot');

  // Questions: a nudge with a link to answer.
  await autopilotPublishers.notifyOwner('questions', db.profiles.findById(profileId), {});
  assert.match(lastSendTo(OWNER.id).params.text, /Autopilot to‘xtab turibdi/);

  // A business that did not link through the shared bot gets nothing.
  const before = tgCalls.length;
  await autopilotPublishers.notifyOwner('questions', db.profiles.findById(otherProfileId), {});
  assert.equal(tgCalls.length, before);
});

const press = (from, data) => ({
  update_id: Date.now(),
  callback_query: { id: `cq${Date.now()}`, from, data, message: { message_id: 42, chat: { id: from.id, type: 'private' } } },
});

test('Post: only the owner can press it; before the slot it is scheduled for the slot', async () => {
  const slot = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
  const approval = queueApproval(slot);

  assert.equal(await hub.handleUpdate(press(STRANGER, `apv:${approval.id}:y`), ctx()), 'refused');
  assert.equal(db.approvals.findById(approval.id).status, 'pending', 'a stranger cannot approve');

  assert.equal(await hub.handleUpdate(press(OWNER, `apv:${approval.id}:y`), ctx()), 'approved');
  assert.equal(db.approvals.findById(approval.id).status, 'approved');
  const row = db.calendar.listByProfile(profileId).find((p) => p.scheduled_time === slot);
  assert.ok(row, 'it waits on the Calendar for its slot');
  assert.equal(row.status, 'scheduled');
  assert.equal(row.source, 'autopilot');
  assert.ok(tgCalls.some((c) => c.method === 'editMessageReplyMarkup' && c.params.message_id === 42), 'the buttons are taken off');
  assert.ok(!tgCalls.some((c) => c.method === 'sendMessage' && c.params.chat_id === String(CHANNEL.id)), 'nothing was posted to the channel yet');

  // Pressing again: already handled.
  assert.equal(await hub.handleUpdate(press(OWNER, `apv:${approval.id}:y`), ctx()), 'refused');
});

test('Skip closes it without posting; junk callback data is ignored', async () => {
  const approval = queueApproval(new Date(Date.now() + 3600 * 1000).toISOString());
  assert.equal(await hub.handleUpdate(press(OWNER, `apv:${approval.id}:n`), ctx()), 'skipped');
  assert.equal(db.approvals.findById(approval.id).status, 'rejected');
  assert.equal(await hub.handleUpdate(press(OWNER, 'something-else'), ctx()), 'ignored');
});
