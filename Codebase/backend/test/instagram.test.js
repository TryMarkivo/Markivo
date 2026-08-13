// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// Entire Instagram (Instagram Business Login) suite commented out along with
// backend/instagram.js and the /api/instagram/* routes. `node --test` treats a
// file with zero registered tests as a pass. Restore with instagram.js.
//
// const { test, before, after } = require('node:test');
// const assert = require('node:assert');
// const os = require('os');
// const path = require('path');
// const fs = require('fs');
//
// // Set env BEFORE requiring the app — config caches env at load. Explicit
// // Instagram creds make this process's instagramEnabled true regardless of .env.
// const TMP_DB = path.join(os.tmpdir(), `markivo-ig-${Date.now()}.db`);
// process.env.DB_PATH = TMP_DB;
// process.env.JWT_SECRET = 'test_secret';
// process.env.NODE_ENV = 'test';
// process.env.INSTAGRAM_APP_ID = 'TEST_APP_ID';
// process.env.INSTAGRAM_APP_SECRET = 'TEST_APP_SECRET';
// process.env.INSTAGRAM_REDIRECT_URI = 'http://localhost:5000/api/instagram/oauth/callback';
//
// // Selective fetch stub: fake the Instagram OAuth hosts, pass localhost through.
// const realFetch = global.fetch;
// let igCalls = [];
// let codeExchangeBody = () => ({ access_token: 'SHORT_TOKEN', user_id: '17841400000000000', permissions: 'instagram_business_basic,instagram_business_content_publish' });
// let videoStatus = () => 'FINISHED';
// global.fetch = async (url, opts) => {
//   const u = String(url);
//   const isIg = u.includes('api.instagram.com') || u.includes('graph.instagram.com');
//   if (!isIg) return realFetch(url, opts);
//
//   const parsed = new URL(u);
//   const q = Object.fromEntries(parsed.searchParams.entries());
//   const pathname = parsed.pathname;
//   igCalls.push({ host: parsed.host, pathname, q, method: opts?.method || 'GET' });
//
//   let body;
//   if (parsed.host === 'api.instagram.com' && pathname.endsWith('/oauth/access_token')) {
//     body = codeExchangeBody();
//   } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/access_token')) {
//     body = { access_token: 'LONG_TOKEN', token_type: 'bearer', expires_in: 5183944 };
//   } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/media_publish')) {
//     body = { id: 'MEDIA_999' };
//   } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/media')) {
//     body = { id: 'CONTAINER_1' };
//   } else if (parsed.host === 'graph.instagram.com' && q.fields === 'status_code') {
//     body = { status_code: videoStatus(), id: pathname.slice(1) };
//   } else if (parsed.host === 'graph.instagram.com' && q.fields === 'permalink') {
//     body = { id: pathname.slice(1), permalink: 'https://www.instagram.com/p/TEST123/' };
//   } else if (parsed.host === 'graph.instagram.com' && pathname.endsWith('/me')) {
//     body = { user_id: '17841400000000000', username: 'noir_cafe', account_type: 'BUSINESS', name: 'Noir Cafe', id: '17841400000000000' };
//   } else {
//     body = { error: { message: `unstubbed ${parsed.host}${pathname}`, code: 404 } };
//   }
//   return { ok: !body.error && !body.error_message, status: (body.error || body.error_message) ? 400 : 200, json: async () => body };
// };
//
// const ig = require('../instagram');
// const { app } = require('../server');
//
// let server, base, access;
// before(async () => {
//   server = app.listen(0);
//   await new Promise((r) => server.once('listening', r));
//   base = `http://127.0.0.1:${server.address().port}`;
//   const reg = await post('/api/auth/register', { email: `ig${Date.now()}@m.uz`, password: 'secret123', fullName: 'IG Owner' });
//   access = (await reg.json()).accessToken;
//   await post('/api/onboarding/construct', {
//     businessName: 'Noir Cafe', category: 'Cafe / Coffee Shop', tone: 'Cozy & Warm', slogan: 'Simplicity, refined.',
//   }, access);
// });
// after(() => {
//   server.close();
//   global.fetch = realFetch;
//   for (const f of [TMP_DB, `${TMP_DB}-shm`, `${TMP_DB}-wal`]) {
//     try { fs.unlinkSync(f); } catch { /* ignore */ }
//   }
// });
//
// const post = (p, body, token) =>
//   global.fetch(base + p, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
//     body: JSON.stringify(body),
//   });
// const get = (p, token) => global.fetch(base + p, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
//
// // --- Unit: the Instagram Login client ---
//
// test('buildAuthUrl targets instagram.com with the business-login scopes', () => {
//   const url = new URL(ig.buildAuthUrl('STATE123'));
//   assert.strictEqual(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
//   assert.strictEqual(url.searchParams.get('client_id'), 'TEST_APP_ID');
//   assert.strictEqual(url.searchParams.get('redirect_uri'), 'http://localhost:5000/api/instagram/oauth/callback');
//   assert.strictEqual(url.searchParams.get('response_type'), 'code');
//   assert.strictEqual(url.searchParams.get('state'), 'STATE123');
//   assert.match(url.searchParams.get('scope'), /instagram_business_content_publish/);
// });
//
// test('exchangeCodeForToken POSTs to api.instagram.com and returns the short token', async () => {
//   igCalls = [];
//   const short = await ig.exchangeCodeForToken('THE_CODE');
//   assert.strictEqual(short.accessToken, 'SHORT_TOKEN');
//   const call = igCalls.find((c) => c.pathname.endsWith('/oauth/access_token'));
//   assert.strictEqual(call.host, 'api.instagram.com');
//   assert.strictEqual(call.method, 'POST');
// });
//
// test('exchangeCodeForToken also handles the data[]-wrapped response shape', async () => {
//   codeExchangeBody = () => ({ data: [{ access_token: 'WRAPPED_TOKEN', user_id: '42' }] });
//   const short = await ig.exchangeCodeForToken('THE_CODE');
//   assert.strictEqual(short.accessToken, 'WRAPPED_TOKEN');
//   assert.strictEqual(short.userId, '42');
//   codeExchangeBody = () => ({ access_token: 'SHORT_TOKEN', user_id: '17841400000000000', permissions: 'instagram_business_basic' });
// });
//
// test('exchangeForLongLivedToken hits graph.instagram.com and returns the long token', async () => {
//   const long = await ig.exchangeForLongLivedToken('SHORT_TOKEN');
//   assert.strictEqual(long.accessToken, 'LONG_TOKEN');
//   assert.ok(long.expiresIn > 0);
// });
//
// test('resolveAccount returns the username and id from /me', async () => {
//   const acct = await ig.resolveAccount('LONG_TOKEN');
//   assert.strictEqual(acct.igUsername, 'noir_cafe');
//   assert.strictEqual(acct.igUserId, '17841400000000000');
//   assert.strictEqual(acct.pageId, null);
// });
//
// test('api.instagram.com error shape surfaces as InstagramError', async () => {
//   const f = global.fetch;
//   global.fetch = async (url, opts) => {
//     if (String(url).includes('instagram.com')) {
//       return { ok: false, status: 400, json: async () => ({ error_type: 'OAuthException', code: 400, error_message: 'Invalid authorization code' }) };
//     }
//     return f(url, opts);
//   };
//   await assert.rejects(() => ig.exchangeCodeForToken('bad'), (err) => {
//     assert.ok(err instanceof ig.InstagramError);
//     assert.match(err.message, /Invalid authorization code/);
//     return true;
//   });
//   global.fetch = f;
// });
//
// // --- Integration: routes + the OAuth round trip ---
//
// test('connect requires auth', async () => {
//   const res = await get('/api/instagram/connect');
//   assert.strictEqual(res.status, 401);
// });
//
// test('connect returns an auth URL embedding a signed state', async () => {
//   const res = await get('/api/instagram/connect', access);
//   assert.strictEqual(res.status, 200);
//   const { authUrl } = await res.json();
//   assert.match(authUrl, /^https:\/\/www\.instagram\.com\/oauth\/authorize/);
//   const state = new URL(authUrl).searchParams.get('state');
//   assert.ok(state && state.split('.').length === 3, 'state should be a JWT');
// });
//
// test('callback exchanges the code, stores the connection, and redirects to the app', async () => {
//   igCalls = [];
//   const { authUrl } = await (await get('/api/instagram/connect', access)).json();
//   const state = new URL(authUrl).searchParams.get('state');
//
//   const cb = await global.fetch(`${base}/api/instagram/oauth/callback?code=FAKE_CODE&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
//   assert.strictEqual(cb.status, 302);
//   assert.match(cb.headers.get('location'), /instagram=connected/);
//
//   const status = await (await get('/api/instagram/status', access)).json();
//   assert.strictEqual(status.connected, true);
//   assert.strictEqual(status.username, 'noir_cafe');
//
//   // The long-lived exchange ran (graph.instagram.com/access_token).
//   assert.ok(igCalls.some((c) => c.host === 'graph.instagram.com' && c.pathname.endsWith('/access_token')));
// });
//
// test('callback with a tampered state redirects to an error, stores nothing', async () => {
//   const cb = await global.fetch(`${base}/api/instagram/oauth/callback?code=X&state=not.a.jwt`, { redirect: 'manual' });
//   assert.strictEqual(cb.status, 302);
//   assert.match(cb.headers.get('location'), /instagram=error&reason=bad_state/);
// });
//
// test('callback without a code redirects with missing_code', async () => {
//   const { authUrl } = await (await get('/api/instagram/connect', access)).json();
//   const state = new URL(authUrl).searchParams.get('state');
//   const cb = await global.fetch(`${base}/api/instagram/oauth/callback?state=${encodeURIComponent(state)}`, { redirect: 'manual' });
//   assert.match(cb.headers.get('location'), /instagram=error&reason=missing_code/);
// });
//
// // --- Publishing (depends on the connection stored by the callback test above) ---
//
// test('createMediaContainer then publishMedia POST to the publishing endpoints', async () => {
//   igCalls = [];
//   const cid = await ig.createMediaContainer('TOKEN', 'IGUSER', { imageUrl: 'https://x/y.jpg', caption: 'hi' });
//   assert.strictEqual(cid, 'CONTAINER_1');
//   const mid = await ig.publishMedia('TOKEN', 'IGUSER', cid);
//   assert.strictEqual(mid, 'MEDIA_999');
//   assert.strictEqual(igCalls.find((c) => c.pathname.endsWith('/media')).method, 'POST');
//   assert.strictEqual(igCalls.find((c) => c.pathname.endsWith('/media_publish')).method, 'POST');
// });
//
// test('POST /api/instagram/post publishes an image and records it on the calendar', async () => {
//   igCalls = [];
//   const res = await post('/api/instagram/post', { caption: 'Weekend special ☕', imageUrl: 'https://example.com/pic.jpg' }, access);
//   assert.strictEqual(res.status, 200);
//   const data = await res.json();
//   assert.strictEqual(data.success, true);
//   assert.strictEqual(data.mediaId, 'MEDIA_999');
//   // container creation then publish both ran
//   assert.ok(igCalls.some((c) => c.pathname.endsWith('/media') && c.method === 'POST'));
//   assert.ok(igCalls.some((c) => c.pathname.endsWith('/media_publish') && c.method === 'POST'));
//   // recorded as a posted instagram calendar entry
//   const cal = await (await get('/api/content/calendar', access)).json();
//   assert.ok(cal.some((p) => p.platform === 'instagram' && p.status === 'posted'));
// });
//
// test('POST /api/instagram/post without an image is rejected (no text-only posts)', async () => {
//   const res = await post('/api/instagram/post', { caption: 'text only' }, access);
//   assert.strictEqual(res.status, 400);
// });
//
// test('publishMediaPost for video polls the container to FINISHED, then publishes', async () => {
//   igCalls = [];
//   videoStatus = () => 'FINISHED';
//   const conn = { accessToken: 'TOK', igUserId: 'IGUSER', igUsername: 'noir_cafe' };
//   const r = await ig.publishMediaPost(conn, { videoUrl: 'https://x/y.mp4', caption: 'reel' }, { sleepFn: async () => {}, delayMs: 0 });
//   assert.strictEqual(r.mediaId, 'MEDIA_999');
//   assert.strictEqual(r.permalink, 'https://www.instagram.com/p/TEST123/');
//   // container created with media_type=REELS + video_url, then a status poll ran
//   assert.ok(igCalls.some((c) => c.pathname.endsWith('/media') && c.method === 'POST'));
//   assert.ok(igCalls.some((c) => c.q.fields === 'status_code'));
// });
//
// test('waitForContainerReady throws when the container status is ERROR', async () => {
//   videoStatus = () => 'ERROR';
//   await assert.rejects(
//     () => ig.waitForContainerReady('TOK', 'CONTAINER_1', { sleepFn: async () => {}, attempts: 3 }),
//     (err) => { assert.ok(err instanceof ig.InstagramError); assert.match(err.message, /ERROR/); return true; }
//   );
//   videoStatus = () => 'FINISHED';
// });
//
// test('POST /api/instagram/post with a videoUrl publishes a Reel', async () => {
//   igCalls = [];
//   const res = await post('/api/instagram/post', { caption: 'A reel 🎬', videoUrl: 'https://example.com/clip.mp4' }, access);
//   assert.strictEqual(res.status, 200);
//   const data = await res.json();
//   assert.strictEqual(data.mediaId, 'MEDIA_999');
//   assert.strictEqual(data.permalink, 'https://www.instagram.com/p/TEST123/');
//   const container = igCalls.find((c) => c.pathname.endsWith('/media') && c.method === 'POST');
//   assert.ok(container, 'a media container was created');
// });
//
// test('POST /api/instagram/post resolves an uploaded mediaId to a public image URL (composer path)', async () => {
//   // 1x1 PNG — exercises the same upload -> mediaId -> publish path the composer uses.
//   const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
//   const up = await post('/api/media/upload', { filename: 'tiny.png', dataUrl: pngDataUrl }, access);
//   assert.strictEqual(up.status, 200);
//   const { id: mediaId } = await up.json();
//
//   igCalls = [];
//   const res = await post('/api/instagram/post', { mediaId, caption: 'From media library' }, access);
//   assert.strictEqual(res.status, 200);
//   const data = await res.json();
//   assert.strictEqual(data.mediaId, 'MEDIA_999');
//   // the container was created from the public /uploads URL, then polled to
//   // FINISHED before publishing (prevents Instagram's "Media ID is not available")
//   assert.ok(igCalls.some((c) => c.pathname.endsWith('/media') && c.method === 'POST'));
//   assert.ok(igCalls.some((c) => c.q.fields === 'status_code'), 'image post polls the container to FINISHED before publishing');
// });
//
// test('disconnect clears the connection', async () => {
//   const res = await post('/api/instagram/disconnect', {}, access);
//   assert.strictEqual(res.status, 200);
//   const status = await (await get('/api/instagram/status', access)).json();
//   assert.strictEqual(status.connected, false);
// });
//
