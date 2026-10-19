const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Set env BEFORE requiring the app — config caches env at load.
const TMP_DB = path.join(os.tmpdir(), `markivo-i18n-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';

const i18n = require('../i18n');
const { app } = require('../server');

let server, base;

before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  for (const f of [TMP_DB, `${TMP_DB}-wal`, `${TMP_DB}-shm`]) fs.rmSync(f, { force: true });
});

const login = (lang) => fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(lang ? { 'Accept-Language': lang } : {}) },
  body: JSON.stringify({ email: 'nobody@example.com', password: 'wrong-password' }),
});

test('pickLang reads the first supported tag and defaults to English', () => {
  assert.strictEqual(i18n.pickLang('uz'), 'uz');
  assert.strictEqual(i18n.pickLang('ru-RU,ru;q=0.9,en;q=0.8'), 'ru');
  assert.strictEqual(i18n.pickLang('de-DE,uz;q=0.5'), 'uz');
  assert.strictEqual(i18n.pickLang('fr'), 'en');
  assert.strictEqual(i18n.pickLang(undefined), 'en');
});

test('an Uzbek client gets Uzbek error messages; English stays English', async () => {
  const uz = await (await login('uz')).json();
  assert.strictEqual(uz.error, "Elektron pochta yoki parol noto'g'ri");

  const en = await (await login('en')).json();
  assert.strictEqual(en.error, 'Incorrect email or password');

  // A browser default (no explicit UI language) is English unless it names a supported one.
  const none = await (await login()).json();
  assert.strictEqual(none.error, 'Incorrect email or password');
});

test('messages with values baked in are translated with the values kept', () => {
  assert.strictEqual(
    i18n.translate("You've used all 5 writing generations on your freemium plan this week. Your allowance resets on 2026-10-26 — or upgrade for more.", 'uz'),
    "Bu hafta Bepul tarifidagi 5 ta matn generatsiyasining barchasidan foydalandingiz. Limit 2026-10-26 kuni yangilanadi — yoki ko'proq uchun tarifni yangilang.",
  );
  assert.match(i18n.translate("video generation isn't included on the freemium plan — upgrade to unlock it.", 'uz'), /^Video yaratish Bepul tarifiga kirmaydi/);
  assert.strictEqual(i18n.translate('Post text must be 280 characters or fewer for this platform.', 'uz'), 'Bu platformada post matni 280 belgidan oshmasligi kerak.');
});

test('an untranslated message passes through unchanged', () => {
  assert.strictEqual(i18n.translate('Some brand-new message', 'uz'), 'Some brand-new message');
  assert.strictEqual(i18n.translate('Incorrect email or password', 'ru'), 'Incorrect email or password');
});

test('every Uzbek translation belongs to a message the backend can actually send', () => {
  // A typo in a key would never match, so the owner would silently see English.
  const dir = path.join(__dirname, '..');
  const sources = ['.', 'connectors', 'marketing', 'providers']
    .flatMap((d) => fs.readdirSync(path.join(dir, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, d, f)))
    .map((f) => fs.readFileSync(f, 'utf8'))
    .join('\n');
  const uz = require('../locales/uz.json');
  assert.deepStrictEqual(Object.keys(uz).filter((msg) => !sources.includes(msg)), []);
});
