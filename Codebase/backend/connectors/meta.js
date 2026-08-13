// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// Entire Meta (Facebook Login + Graph API) adapter pair commented out.
// Nothing imports this file while Meta is disabled: connectors/registry.js
// and competitorFetch.js both have their requires commented too. The empty
// export at the end keeps a stray future require from crashing at import.
//
// // Meta adapter pair — Facebook Pages + Instagram, two faces of ONE OAuth.
// //
// // Facebook and Instagram are published through the same Meta Graph API behind a
// // single "Facebook Login" consent. A business connects once; from that one
// // authorisation we learn (a) the Facebook Page the user manages and (b) the
// // Instagram Business account linked to that Page. So this module exports TWO
// // adapters that share a `group: 'meta'` and a shared OAuth helper, but persist
// // independent connection rows so the dashboard can show / publish to each
// // platform on its own.
// //
// // Compliance: we ONLY publish through Meta's official Graph API, on the user's
// // behalf, with the scopes they grant. No scraping, no impersonation.
// //
// // Official docs:
// //   Facebook Login          https://developers.facebook.com/docs/facebook-login
// //   Pages API — posts       https://developers.facebook.com/docs/pages-api/posts
// //   IG Content Publishing    https://developers.facebook.com/docs/instagram-api/guides/content-publishing
// //
// // SANDBOX rule (the tested path): with no Meta creds configured, isLive() is
// // false → getAuthUrl returns null, publish returns simulatedPublish, status
// // just reads the store. Nothing here ever throws in sandbox mode.
//
// const config = require('../config');
// const { ConnectorError, connected, notConnected, simulatedPublish } = require('./base');
//
// // Pin a versioned Graph API. Meta requires a version in the path; v21.0 is a
// // current Graph version at time of writing. [UNVERIFIED] exact latest version.
// const GRAPH_VERSION = 'v21.0';
// const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
// const DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;
//
// // Scopes requested for the combined Facebook + Instagram flow. pages_* cover
// // Page listing + publishing; instagram_* cover IG account discovery + posting;
// // business_management lets us enumerate assets the user manages.
// const META_SCOPES = [
//   'pages_show_list',
//   'pages_manage_posts',
//   'pages_read_engagement',
//   'business_management',
//   'instagram_basic',
//   'instagram_content_publish',
// ].join(',');
//
// // ---------------------------------------------------------------------------
// // Shared OAuth helpers (module-local, used by BOTH adapters)
// // ---------------------------------------------------------------------------
//
// // Redirect URI for a given adapter key. The start route registers
// // `<redirectBase>/api/connect/<key>/callback`; each adapter points OAuth back
// // at its OWN callback so Meta echoes a redirect_uri that matches what we send
// // during the code exchange (Meta requires the two to be identical).
// function redirectUriFor(key) {
//   return `${config.connectors.redirectBase}/api/connect/${key}/callback`;
// }
//
// // Build the Facebook Login consent URL. redirect_uri is this adapter's own
// // callback; both adapters request the same combined scope set so a single
// // consent yields tokens usable for Page + IG publishing.
// // Docs: https://developers.facebook.com/docs/facebook-login
// function buildAuthUrl(key, state) {
//   const params = new URLSearchParams({
//     client_id: config.connectors.meta.clientId,
//     redirect_uri: redirectUriFor(key),
//     state: state || '',
//     response_type: 'code',
//     scope: META_SCOPES,
//   });
//   return `${DIALOG}?${params.toString()}`;
// }
//
// // Exchange an authorisation code for a USER access token.
// // GET /oauth/access_token?client_id&client_secret&redirect_uri&code
// // Docs: https://developers.facebook.com/docs/facebook-login (manual flow)
// async function exchangeCodeForUserToken(code, callbackKey) {
//   const params = new URLSearchParams({
//     client_id: config.connectors.meta.clientId,
//     client_secret: config.connectors.meta.clientSecret,
//     redirect_uri: redirectUriFor(callbackKey),
//     code,
//   });
//   let res;
//   try {
//     res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`, { method: 'GET' });
//   } catch (err) {
//     throw new ConnectorError('meta_facebook', `Could not reach Meta to exchange the login code (${err.message}).`, 502);
//   }
//   const data = await res.json().catch(() => ({}));
//   if (!res.ok || !data.access_token) {
//     // [UNVERIFIED] Meta returns { error: { message } } on failure.
//     const msg = data && data.error && data.error.message ? data.error.message : 'token exchange failed';
//     throw new ConnectorError('meta_facebook', `Meta login failed: ${msg}`, 400);
//   }
//   return data.access_token; // user access token
// }
//
// // Discover the first manageable Page and its linked Instagram business account.
// // GET /me/accounts?fields=name,access_token,instagram_business_account
// // Returns { page: { id, name, accessToken, igUserId|null } } or null if none.
// // Docs: https://developers.facebook.com/docs/pages-api/posts (Page token usage)
// async function discoverPageAndInstagram(userToken) {
//   const params = new URLSearchParams({
//     fields: 'name,access_token,instagram_business_account',
//     access_token: userToken,
//   });
//   let res;
//   try {
//     res = await fetch(`${GRAPH}/me/accounts?${params.toString()}`, { method: 'GET' });
//   } catch (err) {
//     throw new ConnectorError('meta_facebook', `Could not load your Facebook Pages (${err.message}).`, 502);
//   }
//   const data = await res.json().catch(() => ({}));
//   if (!res.ok) {
//     const msg = data && data.error && data.error.message ? data.error.message : 'could not list Pages';
//     throw new ConnectorError('meta_facebook', `Meta error while listing Pages: ${msg}`, 400);
//   }
//   // [UNVERIFIED] response shape: { data: [ { id, name, access_token,
//   //   instagram_business_account: { id } } ], paging: {...} }
//   const pages = Array.isArray(data.data) ? data.data : [];
//   if (pages.length === 0) return null;
//   const p = pages[0];
//   return {
//     id: p.id,
//     name: p.name || null,
//     accessToken: p.access_token || userToken,
//     igUserId: p.instagram_business_account ? p.instagram_business_account.id : null,
//   };
// }
//
// // Best-effort fetch of an Instagram account's @username for a friendlier handle.
// // GET /{ig-user-id}?fields=username  Docs: instagram-api basic fields.
// async function fetchInstagramHandle(igUserId, pageToken) {
//   try {
//     const params = new URLSearchParams({ fields: 'username', access_token: pageToken });
//     const res = await fetch(`${GRAPH}/${igUserId}?${params.toString()}`, { method: 'GET' });
//     const data = await res.json().catch(() => ({}));
//     // [UNVERIFIED] response: { username: 'name', id: '...' }
//     return data && data.username ? `@${data.username}` : null;
//   } catch {
//     return null;
//   }
// }
//
// // The app-scoped user id of whoever authorized us. Meta's data-deletion
// // callback identifies the person by this id and nothing else, so we capture it
// // at connect time — Page ids and IG business-account ids will not match it.
// // Best-effort: a failure here must not break an otherwise good connection.
// async function fetchMetaUserId(userToken) {
//   try {
//     const params = new URLSearchParams({ fields: 'id', access_token: userToken });
//     const res = await fetch(`${GRAPH}/me?${params.toString()}`, { method: 'GET' });
//     const data = await res.json().catch(() => ({}));
//     return data && data.id ? String(data.id) : null;
//   } catch {
//     return null;
//   }
// }
//
// // Persist BOTH connection rows from one callback. A single Meta login gives us
// // the Page (Facebook) and, if linked, the IG business account (Instagram); we
// // write a row for each so they can be managed/published independently.
// async function persistBothConnections({ db, profile, userToken }) {
//   const page = await discoverPageAndInstagram(userToken);
//   const metaUserId = await fetchMetaUserId(userToken);
//   if (!page) {
//     throw new ConnectorError('meta_facebook', 'No Facebook Page found on your account — create or get admin access to a Page, then reconnect.', 400);
//   }
//
//   // Facebook connection — keyed to the Page, published with the Page token.
//   db.connections.upsert({
//     profileId: profile.id,
//     platform: 'meta_facebook',
//     status: 'connected',
//     accountHandle: page.name,
//     accountId: page.id,
//     accessToken: page.accessToken,
//     scopes: META_SCOPES,
//     meta: { pageId: page.id, metaUserId },
//   });
//
//   // Instagram connection — only if the Page has a linked IG business account.
//   if (page.igUserId) {
//     const igHandle = await fetchInstagramHandle(page.igUserId, page.accessToken);
//     db.connections.upsert({
//       profileId: profile.id,
//       platform: 'meta_instagram',
//       status: 'connected',
//       accountHandle: igHandle || null,
//       accountId: page.igUserId,
//       accessToken: page.accessToken, // IG publishing uses the PAGE token
//       scopes: META_SCOPES,
//       meta: { igUserId: page.igUserId, pageId: page.id, metaUserId },
//     });
//   }
// }
//
// // ---------------------------------------------------------------------------
// // Facebook adapter
// // ---------------------------------------------------------------------------
//
// const facebook = {
//   key: 'meta_facebook',
//   label: 'Facebook',
//   group: 'meta',
//
//   authType: 'oauth',
//   docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
//   requirements: ['A Facebook Page (not a personal profile)', 'Admin access to that Page'],
//   howToConnect: [
//     'Press Connect — we send you to Facebook’s official login screen.',
//     'Sign in with the account that ADMINISTERS your Page.',
//     'On the permissions screen, tick the Page you want Markivo to post to.',
//     'Approve, and Facebook sends you straight back here — connected.',
//   ],
//
//   isLive: () => config.connectors.meta.enabled,
//
//   getAuthUrl({ state }) {
//     if (!this.isLive()) return null;
//     return buildAuthUrl(this.key, state);
//   },
//
//   // One callback persists BOTH the Facebook and Instagram rows (shared OAuth).
//   async handleCallback({ db, profile, query }) {
//     if (!this.isLive()) throw new ConnectorError(this.key, 'Meta is not configured for live connections.', 400);
//     if (!query || !query.code) throw new ConnectorError(this.key, 'Missing authorisation code from Meta.', 400);
//     const userToken = await exchangeCodeForUserToken(query.code, this.key);
//     await persistBothConnections({ db, profile, userToken });
//     return await this.status({ db, profile });
//   },
//
//   async status({ db, profile }) {
//     const conn = db.connections.findByProfile(profile.id, this.key);
//     if (!conn) return notConnected(this);
//     return connected(this, {
//       accountHandle: conn.accountHandle,
//       pageId: conn.meta ? conn.meta.pageId : conn.accountId,
//       ready: !!conn.accessToken,
//     });
//   },
//
//   // Publish a Page feed post. Text-only is allowed for Facebook Pages.
//   // POST /{page-id}/feed { message, access_token }
//   // Docs: https://developers.facebook.com/docs/pages-api/posts
//   async publish({ db, profile, text }) {
//     if (!this.isLive()) return simulatedPublish(this);
//     const conn = db.connections.findByProfile(profile.id, this.key);
//     if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(this);
//
//     const pageId = (conn.meta && conn.meta.pageId) || conn.accountId;
//     const params = new URLSearchParams({ message: text || '', access_token: conn.accessToken });
//     let res;
//     try {
//       res = await fetch(`${GRAPH}/${pageId}/feed`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//         body: params.toString(),
//       });
//     } catch (err) {
//       throw new ConnectorError(this.key, `Could not reach Facebook to publish (${err.message}).`, 502);
//     }
//     const data = await res.json().catch(() => ({}));
//     if (!res.ok || !data.id) {
//       // [UNVERIFIED] success shape: { id: '<page>_<post>' }
//       const msg = data && data.error && data.error.message ? data.error.message : 'Facebook rejected the post';
//       throw new ConnectorError(this.key, `Facebook publish failed: ${msg}`, res.status || 400);
//     }
//     return { simulated: false, platform: this.key, externalId: data.id, target: conn.accountHandle || pageId };
//   },
//
//   async disconnect({ db, profile }) {
//     db.connections.remove(profile.id, this.key);
//   },
//
//   async metrics() {
//     return null;
//   },
// };
//
// // ---------------------------------------------------------------------------
// // Instagram adapter
// // ---------------------------------------------------------------------------
//
// const instagram = {
//   key: 'meta_instagram',
//   label: 'Instagram',
//   authType: 'oauth',
//   docsUrl: 'https://developers.facebook.com/docs/instagram-api/guides/content-publishing',
//   requirements: [
//     'An Instagram Professional account (Business or Creator)',
//     'That account linked to a Facebook Page you administer',
//     'A photo or video for every post — Instagram has no text-only post',
//   ],
//   howToConnect: [
//     'In the Instagram app: Settings → Account type → switch to Business or Creator.',
//     'Still in Instagram settings, link the account to your Facebook Page.',
//     'Press Connect here and sign in with that Facebook account.',
//     'Tick both the Page and the linked Instagram account on the permissions screen.',
//   ],
//   group: 'meta',
//
//   isLive: () => config.connectors.meta.enabled,
//
//   // Instagram rides the SAME Meta consent. Point its auth URL at the shared
//   // flow but keep this adapter's own callback key so redirect_uri matches on
//   // the exchange. The Facebook callback persists both rows; if the user starts
//   // from the Instagram card, this callback does the same via handleCallback.
//   getAuthUrl({ state }) {
//     if (!this.isLive()) return null;
//     return buildAuthUrl(this.key, state);
//   },
//
//   async handleCallback({ db, profile, query }) {
//     if (!this.isLive()) throw new ConnectorError(this.key, 'Meta is not configured for live connections.', 400);
//     if (!query || !query.code) throw new ConnectorError(this.key, 'Missing authorisation code from Meta.', 400);
//     const userToken = await exchangeCodeForUserToken(query.code, this.key);
//     await persistBothConnections({ db, profile, userToken });
//     const conn = db.connections.findByProfile(profile.id, this.key);
//     if (!conn) {
//       // Meta login succeeded but the Page has no linked IG business account.
//       throw new ConnectorError(this.key, 'No Instagram Business account is linked to your Facebook Page — link one in your IG settings, then reconnect.', 400);
//     }
//     return await this.status({ db, profile });
//   },
//
//   async status({ db, profile }) {
//     const conn = db.connections.findByProfile(profile.id, this.key);
//     if (!conn) return notConnected(this);
//     return connected(this, {
//       accountHandle: conn.accountHandle,
//       igUserId: conn.meta ? conn.meta.igUserId : conn.accountId,
//       // IG requires an image — surface that the account can post media.
//       ready: !!conn.accessToken,
//     });
//   },
//
//   // Publish an Instagram image post. IG has NO text-only posts — an image_url
//   // is mandatory. Two-step: create a media container, then publish it.
//   //   POST /{ig-user-id}/media { caption, image_url, access_token } -> creation_id
//   //   POST /{ig-user-id}/media_publish { creation_id, access_token } -> id
//   // Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
//   async publish({ db, profile, text, mediaUrl }) {
//     if (!this.isLive()) return simulatedPublish(this);
//     const conn = db.connections.findByProfile(profile.id, this.key);
//     if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(this);
//
//     if (!mediaUrl) {
//       throw new ConnectorError(this.key, 'Instagram posts need an image — text-only is not supported by the API.', 400);
//     }
//
//     const igUserId = (conn.meta && conn.meta.igUserId) || conn.accountId;
//     const token = conn.accessToken;
//
//     // Step 1 — create the media container.
//     let creationId;
//     {
//       const params = new URLSearchParams({ caption: text || '', image_url: mediaUrl, access_token: token });
//       let res;
//       try {
//         res = await fetch(`${GRAPH}/${igUserId}/media`, {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//           body: params.toString(),
//         });
//       } catch (err) {
//         throw new ConnectorError(this.key, `Could not reach Instagram to upload the image (${err.message}).`, 502);
//       }
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok || !data.id) {
//         // [UNVERIFIED] container response: { id: '<creation-id>' }
//         const msg = data && data.error && data.error.message ? data.error.message : 'media container creation failed';
//         throw new ConnectorError(this.key, `Instagram upload failed: ${msg}`, res.status || 400);
//       }
//       creationId = data.id;
//     }
//
//     // Step 2 — publish the container.
//     {
//       const params = new URLSearchParams({ creation_id: creationId, access_token: token });
//       let res;
//       try {
//         res = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
//           method: 'POST',
//           headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//           body: params.toString(),
//         });
//       } catch (err) {
//         throw new ConnectorError(this.key, `Could not reach Instagram to publish the post (${err.message}).`, 502);
//       }
//       const data = await res.json().catch(() => ({}));
//       if (!res.ok || !data.id) {
//         // [UNVERIFIED] publish response: { id: '<media-id>' }
//         const msg = data && data.error && data.error.message ? data.error.message : 'Instagram rejected the post';
//         throw new ConnectorError(this.key, `Instagram publish failed: ${msg}`, res.status || 400);
//       }
//       return { simulated: false, platform: this.key, externalId: data.id, target: conn.accountHandle || igUserId };
//     }
//   },
//
//   async disconnect({ db, profile }) {
//     db.connections.remove(profile.id, this.key);
//   },
//
//   async metrics() {
//     return null;
//   },
// };
//
// // ---------------------------------------------------------------------------
// // Business Discovery — read a PUBLIC Business/Creator account's own recent
// // media (captions, engagement) via the Graph API feature built for exactly
// // this (competitor/benchmark analysis): no scraping, no login as them, no
// // authorization needed FROM them. Requires the CALLING business's OWN
// // meta_instagram connection (the OAuth above) — the target does not have to
// // grant us anything, but does have to be a public Business or Creator
// // account itself (personal accounts are not queryable this way).
// //   GET /{caller-ig-user-id}?fields=business_discovery.username({target}){...}
// // Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/business-discovery
// // [UNVERIFIED] full field list for business_discovery.media in the current
// // API version — comments_count/like_count/id are docs-confirmed at write
// // time; caption/media_type/timestamp/permalink are the commonly-documented
// // IG Media node fields but weren't freshly re-verified against this exact
// // endpoint. An unsupported field can fail the WHOLE call — callers must treat
// // any failure here as "unavailable" and fall back, never surface it raw.
// async function businessDiscovery(callerIgUserId, targetUsername, accessToken, { fetchImpl = fetch, limit = 25 } = {}) {
//   const mediaFields = 'caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
//   const fields = `business_discovery.username(${targetUsername}){username,name,profile_picture_url,followers_count,media_count,media.limit(${limit}){${mediaFields}}}`;
//   const params = new URLSearchParams({ fields, access_token: accessToken });
//   let res;
//   try {
//     res = await fetchImpl(`${GRAPH}/${callerIgUserId}?${params.toString()}`, { method: 'GET' });
//   } catch (err) {
//     throw new ConnectorError('meta_instagram', `Could not reach Instagram Business Discovery (${err.message}).`, 502);
//   }
//   const data = await res.json().catch(() => ({}));
//   if (!res.ok || !data.business_discovery) {
//     const msg = data && data.error && data.error.message ? data.error.message : 'business_discovery unavailable for this account';
//     throw new ConnectorError('meta_instagram', `Business Discovery failed: ${msg}`, res.status || 400);
//   }
//   return data.business_discovery;
// }
//
// module.exports = { instagram, facebook, businessDiscovery };
//

// DISABLED: SEO/Meta temporarily off — see 2026-08-13
module.exports = {};
