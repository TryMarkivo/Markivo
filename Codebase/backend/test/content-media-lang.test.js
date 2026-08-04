const { test, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Set env BEFORE requiring the app — config caches env at load. Instagram creds
// are set so instagramEnabled is true and the composer's publish path is live;
// PUBLIC_BASE_URL is what lets an uploaded mediaId resolve to a fetchable URL.
const TMP_DB = path.join(os.tmpdir(), `markivo-cml-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.JWT_SECRET = 'test_secret';
process.env.NODE_ENV = 'test';
process.env.INSTAGRAM_APP_ID = 'TEST_APP_ID';
process.env.INSTAGRAM_APP_SECRET = 'TEST_APP_SECRET';
process.env.INSTAGRAM_REDIRECT_URI = 'http://localhost:5000/api/instagram/oauth/callback';
process.env.PUBLIC_BASE_URL = 'https://public.example.com';
// No AI keys: the offline template engine answers, which is exactly the path
// that has to honour the language ORDER without a model in the loop.
process.env.ANTHROPIC_API_KEY = '';
process.env.GEMINI_API_KEY = '';

const realFetch = global.fetch;
let igCalls = [];
global.fetch = async (url, opts) => {
  const u = String(url);
  const isIg = u.includes('api.instagram.com') || u.includes('graph.instagram.com');
  if (!isIg) return realFetch(url, opts);

  const parsed = new URL(u);
  const q = Object.fromEntries(parsed.searchParams.entries());
  const pathname = parsed.pathname;
  igCalls.push({ host: parsed.host, pathname, q, method: opts?.method || 'GET', body: opts?.body });

  let body;
  if (parsed.host === 'api.instagram.com' && pathname.endsWith('/oauth/access_token')) {
    body = { access_token: 'SHORT_TOKEN', user_id: '17841400000000000', permissions: 'instagram_business_basic,instagram_business_content_publish' };
  } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/access_token')) {
    body = { access_token: 'LONG_TOKEN', token_type: 'bearer', expires_in: 5183944 };
  } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/media_publish')) {
    body = { id: 'MEDIA_999' };
  } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/media')) {
    body = { id: 'CONTAINER_1' };
  } else if (parsed.host === 'graph.instagram.com' && q.fields === 'status_code') {
    body = { status_code: 'FINISHED', id: pathname.slice(1) };
  } else if (parsed.host === 'graph.instagram.com' && q.fields === 'permalink') {
    body = { id: pathname.slice(1), permalink: 'https://www.instagram.com/p/TEST123/' };
  } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/me')) {
    body = { user_id: '17841400000000000', username: 'noir_cafe', account_type: 'BUSINESS', name: 'Noir Cafe', id: '17841400000000000' };
  } else {
    body = { error: { message: `unstubbed ${parsed.host}${pathname}`, code: 404 } };
  }
  return { ok: !body.error, status: body.error ? 400 : 200, json: async () => body };
};

const gemini = require('../gemini');
const ai = require('../ai');
const { app, runScheduledPostsTick } = require('../server');

// A 1x1 PNG — the smallest thing /api/media/upload accepts.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

let server, base, access;
before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await post('/api/auth/register', { email: `cml${Date.now()}@m.uz`, password: 'secret123', fullName: 'CML Owner' });
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
const put = (p, body, token) =>
  global.fetch(base + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (p, token) => global.fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

const uploadMedia = async () => {
  const res = await post('/api/media/upload', { filename: 'shot.png', dataUrl: PNG_DATA_URL }, access);
  assert.strictEqual(res.status, 200);
  return (await res.json()).id;
};

// Connect Instagram once, via the real OAuth callback (the stub above answers
// the Instagram hosts). Publishing tests below depend on this connection.
const connectInstagram = async () => {
  const { authUrl } = await (await get('/api/instagram/connect', access)).json();
  const state = new URL(authUrl).searchParams.get('state');
  const cb = await global.fetch(`${base}/api/instagram/oauth/callback?code=FAKE_CODE&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  assert.strictEqual(cb.status, 302);
};

// ===========================================================================
// Language selection — the ORDER the owner picks is the order they get
// ===========================================================================

test('normalizeLanguages keeps the caller order, drops junk and duplicates', () => {
  assert.deepStrictEqual(gemini.normalizeLanguages(['uz', 'ru', 'en']), ['uz', 'ru', 'en']);
  assert.deepStrictEqual(gemini.normalizeLanguages(['ru', 'en']), ['ru', 'en']);
  assert.deepStrictEqual(gemini.normalizeLanguages(['UZ', 'uz', 'fr']), ['uz']);
  // Empty/absent falls back to English rather than producing an empty post.
  assert.deepStrictEqual(gemini.normalizeLanguages([]), ['en']);
  assert.deepStrictEqual(gemini.normalizeLanguages(undefined), ['en']);
});

test('langInstructionFor names the languages in the requested order', () => {
  const instruction = gemini.langInstructionFor(['uz', 'ru', 'en']);
  assert.match(instruction, /1\. Uzbek \(Latin script\)/);
  assert.match(instruction, /2\. Russian/);
  assert.match(instruction, /3\. English/);
  // Order is a hard requirement in the prompt, not a suggestion.
  assert.match(instruction, /Do not reorder/i);
  // Uzbek must be named before Russian in the string itself.
  assert.ok(instruction.indexOf('Uzbek') < instruction.indexOf('Russian'));
});

test('langInstructionFor with one language does not force English', () => {
  assert.match(gemini.langInstructionFor(['ru']), /Russian only/);
  assert.match(gemini.langInstructionFor(['uz']), /Uzbek \(Latin script\) only/);
});

test('offline template output stacks the languages in the chosen order', async () => {
  const uzFirst = await ai.generateContent({
    platform: 'instagram', topic: '', businessName: 'Noir Cafe', languages: ['uz', 'ru', 'en'],
  });
  const uzAt = uzFirst.post.indexOf('🇺🇿');
  const ruAt = uzFirst.post.indexOf('🇷🇺');
  assert.ok(uzAt > -1 && ruAt > -1, 'both language blocks should be present');
  assert.ok(uzAt < ruAt, 'Uzbek should come before Russian when picked first');

  // Reversing the selection reverses the output — the order is really honoured.
  const ruFirst = await ai.generateContent({
    platform: 'instagram', topic: '', businessName: 'Noir Cafe', languages: ['ru', 'uz'],
  });
  assert.ok(ruFirst.post.indexOf('🇷🇺') < ruFirst.post.indexOf('🇺🇿'));
});

test('a single non-English language is not padded with English', async () => {
  const ruOnly = await ai.generateContent({
    platform: 'instagram', topic: '', businessName: 'Noir Cafe', languages: ['ru'],
  });
  assert.ok(ruOnly.post.includes('🇷🇺'));
  assert.ok(!ruOnly.post.includes('🇺🇿'));
});

test('copywrite route accepts an ordered language list', async () => {
  const res = await post('/api/content/copywrite', {
    platform: 'instagram', topic: 'Weekend special', languages: ['uz', 'en'],
  }, access);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.ok(data.post.includes('🇺🇿'));
});

// ===========================================================================
// Media on posts — the Instagram composer fix
// ===========================================================================

test('post-now to Instagram without media is refused with an actionable reason', async () => {
  await connectInstagram();
  const res = await post('/api/content/post-now', {
    platform: 'instagram', postText: 'Weekend special ☕',
  }, access);
  // The old behaviour silently filed a "posted" row and published nothing,
  // which is what made the composer look broken.
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.reason, 'media_required');
  assert.match(data.error, /photo or video/i);
});

test('post-now to Instagram WITH an uploaded mediaId publishes for real', async () => {
  igCalls = [];
  const mediaId = await uploadMedia();
  const res = await post('/api/content/post-now', {
    platform: 'instagram', postText: 'Weekend special ☕', mediaId,
  }, access);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.simulated, false);
  assert.strictEqual(data.mediaId, 'MEDIA_999');
  // The container was created against a PUBLIC url Instagram can fetch.
  const container = igCalls.find((c) => c.pathname.endsWith('/media') && c.method === 'POST');
  assert.ok(container, 'a media container should have been created');
  assert.match(String(container.body), /public\.example\.com/);
});

test('a non-Instagram platform still records a simulated post, with its media', async () => {
  const mediaId = await uploadMedia();
  const res = await post('/api/content/post-now', {
    platform: 'tiktok', postText: 'Behind the counter', mediaId,
  }, access);
  const data = await res.json();
  assert.strictEqual(data.simulated, true);
  assert.strictEqual(data.post.mediaId, mediaId);
});

test('schedule stores the attached media so the worker can publish it later', async () => {
  const mediaId = await uploadMedia();
  const res = await post('/api/content/schedule', {
    platform: 'instagram',
    postText: 'Scheduled with a photo',
    mediaId,
    scheduledTime: new Date(Date.now() - 60000).toISOString(), // already due
  }, access);
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).mediaId, mediaId);

  const cal = await (await get('/api/content/calendar', access)).json();
  assert.ok(cal.some((p) => p.mediaId === mediaId && p.status === 'scheduled'));
});

test('the worker publishes a due Instagram post that carries media', async () => {
  igCalls = [];
  const result = await runScheduledPostsTick();
  assert.ok(result.posted >= 1, 'the due instagram row should have published');
  assert.ok(igCalls.some((c) => c.pathname.endsWith('/media_publish') && c.method === 'POST'));

  const cal = await (await get('/api/content/calendar', access)).json();
  assert.ok(cal.some((p) => p.post_text === 'Scheduled with a photo' && p.status === 'posted'));
});

test('the worker leaves a due Instagram post WITHOUT media scheduled, not failed', async () => {
  await post('/api/content/schedule', {
    platform: 'instagram',
    postText: 'No media, cannot publish',
    scheduledTime: new Date(Date.now() - 60000).toISOString(),
  }, access);

  await runScheduledPostsTick();
  const cal = await (await get('/api/content/calendar', access)).json();
  const row = cal.find((p) => p.post_text === 'No media, cannot publish');
  // Still 'scheduled': attaching media later should make it publishable, so
  // burning it to 'failed' would throw away a recoverable post.
  assert.strictEqual(row.status, 'scheduled');
});

// ===========================================================================
// Media on templates
// ===========================================================================

test('a template saves its media and returns a resolvable URL', async () => {
  const mediaId = await uploadMedia();
  const res = await post('/api/templates', {
    platform: 'instagram',
    name: 'Spots left',
    templateText: 'Stadium No:{{stadium_no}}, {{spots_left}} spots left',
    variables: [{ key: 'stadium_no', label: 'Stadium No', example: '141' }],
    mediaId,
  }, access);
  assert.strictEqual(res.status, 200);
  const tpl = await res.json();
  assert.strictEqual(tpl.mediaId, mediaId);
  assert.match(tpl.mediaUrl, /^\/uploads\//);
  assert.strictEqual(tpl.mediaKind, 'image');

  // The list view carries it too, so the UI can flag which templates have media.
  const list = await (await get('/api/templates?platform=instagram', access)).json();
  assert.strictEqual(list.find((x) => x.id === tpl.id).mediaId, mediaId);

  // Rendering hands the media to the composer along with the filled text.
  const rendered = await (await post(`/api/templates/${tpl.id}/render`, { values: { stadium_no: '7' } }, access)).json();
  assert.match(rendered.text, /Stadium No:7/);
  assert.strictEqual(rendered.mediaId, mediaId);
  assert.match(rendered.mediaUrl, /^\/uploads\//);

  // Editing with an explicit null detaches it.
  const detached = await (await put(`/api/templates/${tpl.id}`, { mediaId: null }, access)).json();
  assert.strictEqual(detached.mediaId, null);
  assert.strictEqual(detached.mediaUrl, null);
});

test('a template without media reports null rather than omitting the fields', async () => {
  const res = await post('/api/templates', {
    platform: 'instagram', name: 'Plain', templateText: 'Open until {{closing_time}}',
  }, access);
  const tpl = await res.json();
  assert.strictEqual(tpl.mediaId, null);
  assert.strictEqual(tpl.mediaUrl, null);
});
