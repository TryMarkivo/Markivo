const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');

const tg = require('../telegram');

// Stub global fetch for api.telegram.org while passing everything else through.
const realFetch = global.fetch;
let calls = [];
let responder = () => ({ ok: true, result: {} });

beforeEach(() => {
  calls = [];
  global.fetch = async (url, opts) => {
    if (String(url).includes('api.telegram.org')) {
      const method = String(url).split('/').pop();
      const params = opts?.body ? JSON.parse(opts.body) : {};
      calls.push({ method, params });
      const body = responder(method, params);
      return { status: body.ok ? 200 : 400, json: async () => body };
    }
    return realFetch(url, opts);
  };
});
after(() => { global.fetch = realFetch; });

test('isValidTokenFormat accepts BotFather-shaped tokens only', () => {
  assert.ok(tg.isValidTokenFormat('1234567890:AAFakeTokenAAAAAAAAAAAAAAAAAAAAAAAA'));
  assert.ok(!tg.isValidTokenFormat('not-a-token'));
  assert.ok(!tg.isValidTokenFormat('1234:short'));
  assert.ok(!tg.isValidTokenFormat(''));
});

test('getMe returns the bot identity', async () => {
  responder = () => ({ ok: true, result: { id: 42, username: 'noir_bot', first_name: 'Noir Bot' } });
  const me = await tg.getMe('1:token');
  assert.strictEqual(me.username, 'noir_bot');
  assert.strictEqual(calls[0].method, 'getMe');
});

test('getMe throws a TelegramError with the API description', async () => {
  responder = () => ({ ok: false, error_code: 401, description: 'Unauthorized' });
  await assert.rejects(() => tg.getMe('1:bad'), (err) => {
    assert.ok(err instanceof tg.TelegramError);
    assert.strictEqual(err.code, 401);
    return true;
  });
});

test('configureBot brands the bot and tolerates per-step failures', async () => {
  responder = (method) =>
    method === 'setMyName'
      ? { ok: false, error_code: 429, description: 'Too Many Requests' } // rate-limited step
      : { ok: true, result: true };

  const results = await tg.configureBot('1:token', {
    businessName: 'Noir Cafe', category: 'Cafe', location: 'Tashkent', slogan: 'Simplicity, refined.',
  });

  assert.strictEqual(results.name, false);
  assert.strictEqual(results.description, true);
  assert.strictEqual(results.shortDescription, true);
  assert.strictEqual(results.commands, true);
  assert.deepStrictEqual(calls.map((c) => c.method), ['setMyName', 'setMyDescription', 'setMyShortDescription', 'setMyCommands']);
  assert.match(calls[1].params.description, /Noir Cafe/);
});

test('detectChat finds the most recent channel the bot was added to', async () => {
  responder = () => ({
    ok: true,
    result: [
      { update_id: 1, message: { chat: { id: 99, type: 'private' } } },
      {
        update_id: 2,
        my_chat_member: {
          chat: { id: -100123, type: 'channel', title: 'Noir News' },
          new_chat_member: { user: { id: 42 }, status: 'administrator' },
        },
      },
    ],
  });
  const found = await tg.detectChat('1:token', 42);
  assert.deepStrictEqual(found, { chatId: '-100123', chatTitle: 'Noir News', chatType: 'channel' });
});

test('detectChat returns null when nothing relevant happened', async () => {
  responder = () => ({ ok: true, result: [] });
  assert.strictEqual(await tg.detectChat('1:token', 42), null);
});

test('verifyPostAccess rejects a channel where the bot cannot post', async () => {
  responder = (method) => {
    if (method === 'getChat') return { ok: true, result: { id: -100123, type: 'channel', title: 'Noir News' } };
    return { ok: true, result: { status: 'member' } }; // member of a channel ≠ can post
  };
  await assert.rejects(() => tg.verifyPostAccess('1:token', '@noir', 42), /administrator/);
});

test('verifyPostAccess accepts an admin with post rights', async () => {
  responder = (method) => {
    if (method === 'getChat') return { ok: true, result: { id: -100123, type: 'channel', title: 'Noir News' } };
    return { ok: true, result: { status: 'administrator', can_post_messages: true } };
  };
  const chat = await tg.verifyPostAccess('1:token', '@noir', 42);
  assert.strictEqual(chat.chatId, '-100123');
});

test('sendMessage posts to the chat', async () => {
  responder = () => ({ ok: true, result: { message_id: 7 } });
  const sent = await tg.sendMessage('1:token', '-100123', 'Hello channel');
  assert.strictEqual(sent.message_id, 7);
  assert.deepStrictEqual(calls[0].params, { chat_id: '-100123', text: 'Hello channel' });
});
