// Autopilot learns ONLY from the posts the owner forwards to the shared bot
// (config.autopilotLearnFrom = 'forwarded', the default for now): the linked
// channel's own posts are not saved, read, learned from, or shown to the
// copywriter.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP_DB = path.join(os.tmpdir(), `markivo-apfwd-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.AUTONOMOUS_ENABLED = 'true';
process.env.TELEGRAM_ENABLED = 'true';
process.env.META_CLIENT_ID = '';
process.env.META_CLIENT_SECRET = '';
// Defined but blank, so a local .env can't switch the default under test.
process.env.AUTOPILOT_LEARN_FROM = '';
const SHARED_TOKEN = '999:shared-bot-token';
process.env.TELEGRAM_BOT_TOKEN = SHARED_TOKEN;

const BOT = { id: 999, is_bot: true, username: 'markivo_bot' };
const OWNER = { id: 4242, first_name: 'Owner', language_code: 'en' };
const CHANNEL = { id: -1001234, type: 'channel', title: 'Our Channel', username: 'ourchannel' };

const realFetch = global.fetch;
const tgCalls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('api.telegram.org')) return realFetch(url, opts);
  const [, , method] = /\/bot([^/]+)\/(\w+)$/.exec(u);
  const params = opts?.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
  tgCalls.push({ method, params });
  return { status: 200, json: async () => ({ ok: true, result: { message_id: 1000 + tgCalls.length } }) };
};

const { app, db } = require('../server');
const config = require('../config');
const hub = require('../telegramHub');
const style = require('../autopilotStyle');
const autonomous = require('../autonomous');
const connectors = require('../connectors/registry');

let server, base, profileId;
const ctx = () => ({ db, token: SHARED_TOKEN, me: BOT, log: { warn() {} } });
const post = (p, body, token) => realFetch(base + p, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const forward = (messageId, text, chat = CHANNEL) => ({
  update_id: Date.now() + messageId,
  message: {
    message_id: messageId, from: OWNER, chat: { id: OWNER.id, type: 'private' }, date: 1790000000, text,
    forward_origin: { type: 'channel', chat, message_id: messageId, date: 1790000000 + messageId * 3600 },
  },
});
const lastReply = () => [...tgCalls].reverse().find((c) => c.method === 'sendMessage' && c.params.chat_id === OWNER.id);

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await post('/api/auth/register', { email: `fwd${Date.now()}@m.uz`, password: 'secret123', fullName: 'Fwd', preferredLang: 'en' });
  const access = (await reg.json()).accessToken;
  const onb = await post('/api/onboarding/construct', { businessName: 'Fwd Cafe', category: 'Cafe' }, access);
  profileId = (await onb.json()).profile.id;
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

test('forwarded posts are the default source', () => {
  assert.equal(config.autopilotLearnFrom, 'forwarded');
});

test('a new post in the linked channel is not saved', async () => {
  const r = await hub.handleUpdate({ update_id: 1, channel_post: { message_id: 7, chat: CHANNEL, date: 1790000000, text: 'A post in the channel itself' } }, ctx());
  assert.equal(r, 'ignored');
  assert.equal(db.ownContent.countByProfile(profileId), 0);
});

test('forwards are saved; a forward of an already-saved channel post marks it forwarded; the count is forwards only', async () => {
  // A row from an earlier channel read (e.g. saved before the switch).
  db.ownContent.mergePosts(profileId, 'telegram', [{ externalId: '55', caption: 'Scraped channel post about our menu', postedAt: '2026-10-01T10:00:00Z' }]);
  db.ownContent.mergePosts(profileId, 'telegram', [{ externalId: '56', caption: 'Another scraped post nobody forwarded', postedAt: '2026-10-02T10:00:00Z' }], { source: 'bot' });

  assert.equal(await hub.handleUpdate(forward(55, 'Scraped channel post about our menu'), ctx()), 'learned');
  const row55 = db.ownContent.listByProfile(profileId).find((p) => p.externalId === '55');
  assert.equal(row55.source, 'forwarded');
  assert.match(lastReply().params.text, /\(1 posts so far\)/);

  await hub.handleUpdate(forward(9, 'A post from my other channel worth learning from', { id: -100777, type: 'channel', title: 'Old' }), ctx());
  assert.match(lastReply().params.text, /\(2 posts so far\)/, 'the un-forwarded channel row is not counted');

  // A later scrape of the same post never demotes it.
  db.ownContent.mergePosts(profileId, 'telegram', [{ externalId: '55', caption: 'Scraped channel post about our menu', viewCount: 40 }]);
  assert.equal(db.ownContent.listByProfile(profileId).find((p) => p.externalId === '55').source, 'forwarded');
});

test('style samples come from forwarded posts only — not the channel, not Markivo\'s own posts', () => {
  db.calendar.add({ profileId, platform: 'telegram', postText: 'Something Markivo published for them earlier', scheduledTime: '2026-10-03T10:00:00Z', status: 'posted' });
  const samples = style.collectSamples(db, profileId);
  assert.deepEqual(samples.map((s) => s.source), ['forwarded', 'forwarded']);
  assert.ok(!samples.some((s) => /nobody forwarded|Markivo published/.test(s.text)));
  // 'all' still sees every source.
  assert.equal(style.collectSamples(db, profileId, { learnFrom: 'all' }).length, 4);
});

test('the worker does not read the channel and grounds the post in forwarded posts only', async () => {
  db.autonomous.saveBrief(profileId, { themes: ['auto'], goal: 'auto', tone: 'auto', length: 'auto', emoji: 'auto', scheduleAsked: 'auto' });
  db.autonomous.upsertConfig({ profileId, enabled: true, platforms: ['telegram'], frequency: 'scheduled', autoPublish: false, nextRunAt: new Date().toISOString() });
  const ownContentFetch = { fetchOwnContent: async () => { throw new Error('must not read the channel'); } };
  let seen = null;
  const ai = { analyzeAndPlan: async (c) => { seen = c; return { analysis: 'ok', posts: [{ platform: 'telegram', text: 'Hello' }] }; } };
  const result = await autonomous.runProfileAutopilot({
    db, ai, connectors, config, publishers: {}, ownContentFetch, profileId, nowMs: Date.now(), force: true,
  });
  assert.ok(!result.error && !result.paused, JSON.stringify(result));
  assert.ok(seen, 'the post was written');
  assert.equal(seen.ownExternalActivity.length, 2);
  assert.ok(seen.ownExternalActivity.every((line) => !/nobody forwarded/.test(line)));
  const grounded = db.autonomous.listActivity(profileId, 20).find((a) => a.kind === 'external_content');
  assert.match(grounded.summary, /2 posts you forwarded to the bot/);
});
