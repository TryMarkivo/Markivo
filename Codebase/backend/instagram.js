// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// Entire Instagram Business Login client commented out. Nothing imports this
// file while Meta is disabled (server.js:19 and test/instagram.test.js both
// have their requires commented). The empty export keeps a stray future
// require from crashing at import time.
//
// // Instagram client for the "Connect Instagram" OAuth flow, using the
// // **Instagram API with Instagram Login** (Business Login, launched 2024) — NOT
// // the older Facebook-Login Instagram Graph path. No SDK; plain HTTPS via fetch.
// //
// // Flow: dashboard sends the owner to buildAuthUrl() → instagram.com auth dialog →
// // Instagram redirects back to our callback with ?code= → exchangeCodeForToken()
// // (api.instagram.com) → exchangeForLongLivedToken() (graph.instagram.com) →
// // resolveAccount() for the username. The long-lived token (~60 days) is stored
// // encrypted (see db.instagram).
// //
// // Credentials are the **Instagram** app ID/secret (distinct from the Facebook
// // app's), found under the app's Instagram product → API setup with Instagram
// // login. Routes gate on config.instagramEnabled before calling in.
//
// const config = require('./config');
//
// const AUTH_BASE = 'https://www.instagram.com';
// const API_BASE = 'https://api.instagram.com';
// const GRAPH_BASE = 'https://graph.instagram.com';
//
// class InstagramError extends Error {
//   constructor(message, code, type) {
//     super(`Instagram: ${message}`);
//     this.name = 'InstagramError';
//     this.code = code;
//     this.type = type;
//   }
// }
//
// // Instagram returns two error shapes: api.instagram.com → { error_type, code,
// // error_message }; graph.instagram.com → { error: { message, type, code } }.
// function throwIfError(data, status) {
//   if (data && data.error) {
//     throw new InstagramError(data.error.message || `HTTP ${status}`, data.error.code, data.error.type);
//   }
//   if (data && data.error_message) {
//     throw new InstagramError(data.error_message, data.code, data.error_type);
//   }
// }
//
// async function parseJson(res, label) {
//   let data;
//   try {
//     data = await res.json();
//   } catch {
//     throw new InstagramError(`${label}: non-JSON response (HTTP ${res.status})`, res.status, 'parse');
//   }
//   throwIfError(data, res.status);
//   if (!res.ok) throw new InstagramError(`${label}: HTTP ${res.status}`, res.status, 'http');
//   return data;
// }
//
// /**
//  * The Instagram auth-dialog URL the browser is redirected to. `state` is our
//  * signed CSRF/identity token (see server.js signOauthState). redirect_uri must
//  * match what's registered in the Instagram business-login settings.
//  */
// function buildAuthUrl(state) {
//   const url = new URL(`${AUTH_BASE}/oauth/authorize`);
//   url.searchParams.set('client_id', config.instagramAppId);
//   url.searchParams.set('redirect_uri', config.instagramRedirectUri);
//   url.searchParams.set('response_type', 'code');
//   url.searchParams.set('scope', config.instagramScopes);
//   url.searchParams.set('state', state);
//   return url.toString();
// }
//
// // Exchange the one-time ?code= for a short-lived token (POST, form-encoded).
// // The redirect_uri must be byte-identical to the one used in buildAuthUrl.
// async function exchangeCodeForToken(code) {
//   let res;
//   try {
//     res = await fetch(`${API_BASE}/oauth/access_token`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//       body: new URLSearchParams({
//         client_id: config.instagramAppId,
//         client_secret: config.instagramAppSecret,
//         grant_type: 'authorization_code',
//         redirect_uri: config.instagramRedirectUri,
//         code,
//       }).toString(),
//     });
//   } catch (err) {
//     throw new InstagramError(`network error (${err.message})`, 0, 'network');
//   }
//   const data = await parseJson(res, 'code exchange');
//   // Newer responses may wrap the token node in a data[] array.
//   const node = Array.isArray(data.data) ? data.data[0] : data;
//   if (!node || !node.access_token) throw new InstagramError('no access_token in code exchange response', 0, 'oauth');
//   return { accessToken: node.access_token, userId: node.user_id != null ? String(node.user_id) : null };
// }
//
// // Upgrade the short-lived token to a long-lived (~60-day) one.
// async function exchangeForLongLivedToken(shortToken) {
//   const url = new URL(`${GRAPH_BASE}/access_token`);
//   url.searchParams.set('grant_type', 'ig_exchange_token');
//   url.searchParams.set('client_secret', config.instagramAppSecret);
//   url.searchParams.set('access_token', shortToken);
//
//   let res;
//   try {
//     res = await fetch(url, { method: 'GET' });
//   } catch (err) {
//     throw new InstagramError(`network error (${err.message})`, 0, 'network');
//   }
//   const data = await parseJson(res, 'long-lived exchange');
//   if (!data.access_token) throw new InstagramError('no access_token in long-lived exchange response', 0, 'oauth');
//   return { accessToken: data.access_token, expiresIn: data.expires_in || null };
// }
//
// /**
//  * Resolve the connected account's username/id. No Facebook Page involved in this
//  * flow — the token IS the Instagram account.
//  */
// async function resolveAccount(token) {
//   const url = new URL(`${GRAPH_BASE}/me`);
//   url.searchParams.set('fields', 'user_id,username,account_type,name');
//   url.searchParams.set('access_token', token);
//
//   let res;
//   try {
//     res = await fetch(url, { method: 'GET' });
//   } catch (err) {
//     throw new InstagramError(`network error (${err.message})`, 0, 'network');
//   }
//   const me = await parseJson(res, 'account lookup');
//   return {
//     igUserId: me.user_id != null ? String(me.user_id) : (me.id != null ? String(me.id) : null),
//     igUsername: me.username || null,
//     pageId: null,
//     accountName: me.name || me.username || null,
//   };
// }
//
// /**
//  * Account-level numbers for the platform drill-down. `followers_count` and
//  * `media_count` are only returned for Business/Creator accounts; a personal
//  * account answers without them, so every field is optional by design and the
//  * caller reports what it actually got rather than filling blanks with zeros.
//  */
// async function getAccountStats(token) {
//   const url = new URL(`${GRAPH_BASE}/me`);
//   url.searchParams.set('fields', 'user_id,username,account_type,name,followers_count,follows_count,media_count');
//   url.searchParams.set('access_token', token);
//   const me = await graphGet(url.toString());
//   return {
//     username: me.username || null,
//     accountName: me.name || me.username || null,
//     accountType: me.account_type || null,
//     followers: Number.isFinite(me.followers_count) ? me.followers_count : null,
//     following: Number.isFinite(me.follows_count) ? me.follows_count : null,
//     mediaCount: Number.isFinite(me.media_count) ? me.media_count : null,
//   };
// }
//
// /**
//  * The account's own recent posts WITH engagement. This is the only place in the
//  * product where real per-post interaction numbers exist — like_count and
//  * comments_count come straight from the Graph API. Anything the API omits stays
//  * null so the UI can say "not reported" instead of showing a fabricated 0.
//  */
// async function getRecentMedia(token, limit = 12) {
//   const url = new URL(`${GRAPH_BASE}/me/media`);
//   url.searchParams.set(
//     'fields',
//     'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count'
//   );
//   url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 25)));
//   url.searchParams.set('access_token', token);
//   const data = await graphGet(url.toString());
//   const items = Array.isArray(data.data) ? data.data : [];
//   return items.map((m) => ({
//     id: String(m.id),
//     caption: m.caption || '',
//     mediaType: m.media_type || null,
//     // Videos expose a still under thumbnail_url; media_url is the MP4.
//     thumbnail: m.thumbnail_url || m.media_url || null,
//     permalink: m.permalink || null,
//     timestamp: m.timestamp || null,
//     likes: Number.isFinite(m.like_count) ? m.like_count : null,
//     comments: Number.isFinite(m.comments_count) ? m.comments_count : null,
//   }));
// }
//
// // --- Content publishing (graph.instagram.com) ---
// // Two-step flow: create a media container from a PUBLIC media URL, then publish
// // it. Instagram fetches the URL server-side, so it must be reachable from the
// // internet (JPEG for images, MP4/MOV for video). There is no text-only post
// // type. Containers process asynchronously (video/Reels slowly, images fast), so
// // we poll the container's status_code until FINISHED before publishing — calling
// // media_publish too early returns Instagram's opaque "Media ID is not available".
//
// const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
//
// async function graphPost(pathname, params) {
//   let res;
//   try {
//     res = await fetch(`${GRAPH_BASE}/${pathname}`, {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//       body: new URLSearchParams(params).toString(),
//     });
//   } catch (err) {
//     throw new InstagramError(`network error (${err.message})`, 0, 'network');
//   }
//   return parseJson(res, 'publish');
// }
//
// async function graphGet(url) {
//   let res;
//   try {
//     res = await fetch(url, { method: 'GET' });
//   } catch (err) {
//     throw new InstagramError(`network error (${err.message})`, 0, 'network');
//   }
//   return parseJson(res, 'graph get');
// }
//
// // Step 1 — create a media container (image OR video). Returns its creation id.
// async function createMediaContainer(token, igUserId, { imageUrl, videoUrl, mediaType, caption }) {
//   const params = { access_token: token, ...(caption ? { caption } : {}) };
//   if (videoUrl) {
//     // Feed video posts go through the Reels product on this API.
//     params.media_type = mediaType || 'REELS';
//     params.video_url = videoUrl;
//   } else if (imageUrl) {
//     params.image_url = imageUrl;
//   } else {
//     throw new InstagramError('createMediaContainer requires an imageUrl or videoUrl', 0, 'publish');
//   }
//   const data = await graphPost(`${igUserId}/media`, params);
//   if (!data.id) throw new InstagramError('no container id in create-media response', 0, 'publish');
//   return data.id;
// }
//
// // Step 2 — publish a previously-created container; returns the published media id.
// async function publishMedia(token, igUserId, creationId) {
//   const data = await graphPost(`${igUserId}/media_publish`, {
//     creation_id: creationId,
//     access_token: token,
//   });
//   if (!data.id) throw new InstagramError('no media id in media-publish response', 0, 'publish');
//   return data.id;
// }
//
// // Poll a container's processing state (mainly for video). Returns the status_code
// // string: IN_PROGRESS | FINISHED | ERROR | EXPIRED | PUBLISHED.
// async function getContainerStatus(token, creationId) {
//   const url = new URL(`${GRAPH_BASE}/${creationId}`);
//   url.searchParams.set('fields', 'status_code');
//   url.searchParams.set('access_token', token);
//   const data = await graphGet(url);
//   return data.status_code;
// }
//
// // Wait until a (video) container finishes processing before it can be published.
// // `opts.sleepFn` is injectable for tests; defaults to real timers.
// async function waitForContainerReady(token, creationId, opts = {}) {
//   const attempts = opts.attempts || 24;
//   const delayMs = opts.delayMs == null ? 5000 : opts.delayMs;
//   const wait = opts.sleepFn || sleep;
//   for (let i = 0; i < attempts; i++) {
//     const status = await getContainerStatus(token, creationId);
//     if (status === 'FINISHED') return;
//     if (status === 'ERROR' || status === 'EXPIRED') {
//       throw new InstagramError(`media processing ${status}`, 0, 'publish');
//     }
//     await wait(delayMs);
//   }
//   throw new InstagramError('media processing timed out — try again', 0, 'publish');
// }
//
// // Best-effort permalink for a published post (for nice UX); null on failure.
// async function getPermalink(token, mediaId) {
//   try {
//     const url = new URL(`${GRAPH_BASE}/${mediaId}`);
//     url.searchParams.set('fields', 'permalink');
//     url.searchParams.set('access_token', token);
//     const data = await graphGet(url);
//     return data.permalink || null;
//   } catch {
//     return null;
//   }
// }
//
// // High-level: create + poll-to-FINISHED + publish a post for a stored
// // connection. Accepts { imageUrl } or { videoUrl, mediaType }. Returns ids +
// // permalink. `opts` is forwarded to the status poll (test injection).
// async function publishMediaPost(conn, { imageUrl, videoUrl, mediaType, caption }, opts = {}) {
//   const creationId = await createMediaContainer(conn.accessToken, conn.igUserId, { imageUrl, videoUrl, mediaType, caption });
//   // Poll the container to FINISHED before publishing. Video (Reels) needs a long
//   // window; images finish in seconds but STILL must be polled — Instagram fetches
//   // the image URL server-side, and publishing before the container is FINISHED
//   // returns the opaque "Media ID is not available". An unreachable URL now
//   // surfaces as a clear "media processing ERROR" instead.
//   const pollOpts = videoUrl ? opts : { attempts: 15, delayMs: 3000, ...opts };
//   await waitForContainerReady(conn.accessToken, creationId, pollOpts);
//   const mediaId = await publishMedia(conn.accessToken, conn.igUserId, creationId);
//   const permalink = await getPermalink(conn.accessToken, mediaId);
//   return { creationId, mediaId, permalink };
// }
//
// // Backward-compatible image-only helper.
// async function publishImage(conn, { imageUrl, caption }) {
//   return publishMediaPost(conn, { imageUrl, caption });
// }
//
// module.exports = {
//   InstagramError,
//   buildAuthUrl,
//   exchangeCodeForToken,
//   exchangeForLongLivedToken,
//   resolveAccount,
//   getAccountStats,
//   getRecentMedia,
//   createMediaContainer,
//   publishMedia,
//   getContainerStatus,
//   waitForContainerReady,
//   getPermalink,
//   publishMediaPost,
//   publishImage,
// };
//

// DISABLED: SEO/Meta temporarily off — see 2026-08-13
module.exports = {};
