const { test, after } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const sources = require('../competitorSources');

// The adapters call telegram.js, which uses global fetch. Stub it per-test.
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const stubTelegram = (handler) => {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://api.telegram.org/')) return handler(u, opts);
    return realFetch(url, opts);
  };
};
const ok = (result) => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });
const tgError = (description, code) => ({
  ok: false, status: code, json: async () => ({ ok: false, description, error_code: code }),
});

const ctxWithBot = (botToken = '123456:AA') => ({
  profile: { id: 'p1' },
  db: { telegram: { findByProfile: () => (botToken ? { botToken } : null) } },
});

test('normalizeTelegramChannel accepts the shapes an owner actually pastes', () => {
  assert.strictEqual(sources.normalizeTelegramChannel('@brewdistrict'), '@brewdistrict');
  assert.strictEqual(sources.normalizeTelegramChannel('brewdistrict'), '@brewdistrict');
  assert.strictEqual(sources.normalizeTelegramChannel('t.me/brewdistrict'), '@brewdistrict');
  assert.strictEqual(sources.normalizeTelegramChannel('https://t.me/brewdistrict'), '@brewdistrict');
  assert.strictEqual(sources.normalizeTelegramChannel('https://t.me/brewdistrict/'), '@brewdistrict');
  assert.strictEqual(sources.normalizeTelegramChannel(''), null);
  assert.strictEqual(sources.normalizeTelegramChannel(null), null);
  assert.strictEqual(sources.normalizeTelegramChannel('!!'), null);
});

test('telegram: a public channel yields a MEASURED follower count with provenance', async () => {
  stubTelegram(() => ok(4137));
  const out = await sources.enrich(
    { telegramChannel: '@brewdistrict', instagramHandle: null },
    ctxWithBot()
  );
  assert.strictEqual(out.fields.followersCount, 4137);
  assert.strictEqual(out.sources.followers, 'telegram', 'the number is attributed to Telegram, not the owner');
  assert.strictEqual(out.report.telegram.ok, true);
});

test('telegram: a channel the bot cannot read stays UNKNOWN, never 0', async () => {
  stubTelegram(() => tgError('Bad Request: chat not found', 400));
  const out = await sources.enrich(
    { telegramChannel: '@privateone', instagramHandle: null },
    ctxWithBot()
  );
  assert.deepStrictEqual(out.fields, {}, 'an unreadable channel writes no number at all');
  assert.strictEqual(out.report.telegram.ok, false);
  assert.strictEqual(out.report.telegram.reason, 'not_public');
});

test('telegram: a bot that is not a member degrades the same way', async () => {
  stubTelegram(() => tgError('Forbidden: bot is not a member of the channel chat', 403));
  const out = await sources.enrich({ telegramChannel: '@members-only' }, ctxWithBot());
  assert.deepStrictEqual(out.fields, {});
  assert.strictEqual(out.report.telegram.reason, 'not_public');
});

test('telegram: no channel on file, and no bot connected, report distinct codes', async () => {
  stubTelegram(() => ok(1));

  const noHandle = await sources.enrich({ telegramChannel: null }, ctxWithBot());
  assert.strictEqual(noHandle.report.telegram.reason, 'no_handle');

  const noBot = await sources.enrich({ telegramChannel: '@brew' }, ctxWithBot(null));
  assert.strictEqual(noBot.report.telegram.reason, 'no_telegram_bot');
});

test('telegram: a network failure is contained, not thrown', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).startsWith('https://api.telegram.org/')) throw new Error('ECONNRESET');
    return realFetch(url);
  };
  const out = await sources.enrich({ telegramChannel: '@brew' }, ctxWithBot());
  assert.deepStrictEqual(out.fields, {});
  assert.strictEqual(out.report.telegram.ok, false);
});

// business_discovery would give real follower counts and a real cadence, but it
// needs graph.facebook.com with a Page-linked token, and this app authenticates
// through Instagram Login. The stub reports that distinctly so the UI can say
// so, rather than looking like an ordinary failure.
test('instagram: reports auth_upgrade_required, distinct from a missing handle', async () => {
  stubTelegram(() => ok(1));

  const withHandle = await sources.enrich({ instagramHandle: 'brewdistrict' }, ctxWithBot());
  assert.strictEqual(withHandle.report.instagram.ok, false);
  assert.strictEqual(withHandle.report.instagram.reason, 'auth_upgrade_required');
  assert.strictEqual(withHandle.fields.followersCount, undefined);

  const without = await sources.enrich({ instagramHandle: null }, ctxWithBot());
  assert.strictEqual(without.report.instagram.reason, 'no_handle');
});

test('every reason is a translatable CODE, never a sentence', async () => {
  stubTelegram(() => tgError('Bad Request: chat not found', 400));
  const out = await sources.enrich({ telegramChannel: '@x1234', instagramHandle: 'ig' }, ctxWithBot());
  for (const [name, r] of Object.entries(out.report)) {
    if (r.ok) continue;
    assert.match(r.reason, /^[a-z_]+$/, `${name} reason must be a code the UI can translate`);
  }
});
