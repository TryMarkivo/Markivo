const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate DB + secret BEFORE requiring the app (config reads env at load).
// No ANTHROPIC_API_KEY → the agent runs in template (keyless) mode.
// TELEGRAM_ENABLED is deliberately NOT set → telegram stays coming-soon.
const TMP_DB = path.join(os.tmpdir(), `markivo-agentmem-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
delete process.env.TELEGRAM_ENABLED;

const { app } = require('../server');
const createDb = require('../db');

let server, base, access;

const post = (p, body) =>
  fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify(body),
  });

const getHistory = async () =>
  (await fetch(`${base}/api/agent/history`, { headers: { Authorization: `Bearer ${access}` } })).json();

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `mem${Date.now()}@m.uz`, password: 'secret123', fullName: 'Memory Tester' }),
  });
  access = (await reg.json()).accessToken;
  await post('/api/onboarding/construct', { businessName: 'Memory Cafe' });
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});

test('a query stores both the user and agent rows in history', async () => {
  const res = await post('/api/agent/query', { query: 'How are my metrics?' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.reply && data.reply.length > 0);

  const h = await getHistory();
  assert.strictEqual(h.messages.length, 2);
  assert.strictEqual(h.messages[0].sender, 'user');
  assert.strictEqual(h.messages[0].text, 'How are my metrics?');
  assert.strictEqual(h.messages[1].sender, 'agent');
  assert.strictEqual(h.messages[1].text, data.reply);
  assert.ok(h.messages[0].created_at, 'rows carry created_at');
});

test("a second query's reply is appended in chronological order", async () => {
  const data = await (await post('/api/agent/query', { query: 'how are my competitors doing?' })).json();
  assert.ok(data.reply && data.reply.length > 0);

  const h = await getHistory();
  assert.strictEqual(h.messages.length, 4);
  assert.strictEqual(h.messages[2].sender, 'user');
  assert.strictEqual(h.messages[2].text, 'how are my competitors doing?');
  assert.strictEqual(h.messages[3].sender, 'agent');
  assert.strictEqual(h.messages[3].text, data.reply);
});

test("lang 'ru' gets a localized Cyrillic template reply", async () => {
  const data = await (await post('/api/agent/query', { query: 'Расскажи о себе', lang: 'ru' })).json();
  assert.match(data.reply, /[А-Яа-яЁё]/, `expected Cyrillic in: ${data.reply}`);
});

test("lang 'uz' gets a localized Latin-Uzbek template reply", async () => {
  const data = await (await post('/api/agent/query', { query: "O'zing haqingda aytib ber", lang: 'uz' })).json();
  assert.ok(
    /siz|yo'q|uchun|yordam/i.test(data.reply),
    `expected an Uzbek marker (siz/yo'q/uchun/yordam) in: ${data.reply}`
  );
});

test('telegram coming-soon reply is localized for ru and still skips approval', async () => {
  const res = await post('/api/agent/query', { query: 'Опубликовать пост в телеграм канал', lang: 'ru' });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(!data.triggerApproval, 'coming-soon must not open an approval dialog');
  assert.match(data.reply, /[А-Яа-яЁё]/, `expected Cyrillic in: ${data.reply}`);
  assert.match(data.reply, /скоро/i, `expected "скоро" in: ${data.reply}`);
});

test('DELETE clears the conversation history', async () => {
  const res = await fetch(`${base}/api/agent/history`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${access}` },
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), { success: true });

  const h = await getHistory();
  assert.deepStrictEqual(h.messages, []);
});

test('agentMessages.listByProfile returns the last N rows chronologically', () => {
  const db = createDb(':memory:');
  const u = db.users.create({ email: 'mem@db.uz', passwordHash: 'h', fullName: 'M' });
  const p = db.profiles.create({ userId: u.id, businessName: 'Mem Biz' });
  for (let i = 1; i <= 5; i++) {
    db.agentMessages.add({ profileId: p.id, sender: i % 2 ? 'user' : 'agent', text: `m${i}` });
  }
  const last3 = db.agentMessages.listByProfile(p.id, 3);
  assert.deepStrictEqual(last3.map((r) => r.text), ['m3', 'm4', 'm5']);
  assert.strictEqual(db.agentMessages.listByProfile(p.id).length, 5, 'default limit covers all rows');

  db.agentMessages.clearByProfile(p.id);
  assert.strictEqual(db.agentMessages.listByProfile(p.id).length, 0);
  db.close();
});
