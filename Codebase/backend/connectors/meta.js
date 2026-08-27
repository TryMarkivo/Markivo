// Meta adapter pair — Facebook Pages + Instagram, two faces of ONE OAuth.
//
// Facebook and Instagram are published through the same Meta Graph API behind a
// single "Facebook Login" consent. A business connects once; from that one
// authorisation we learn (a) the Facebook Page the user manages and (b) the
// Instagram Business account linked to that Page. So this module exports TWO
// adapters that share a `group: 'meta'` and a shared OAuth helper, but persist
// independent connection rows so the dashboard can show / publish to each
// platform on its own.
//
// Compliance: we ONLY publish through Meta's official Graph API, on the user's
// behalf, with the scopes they grant. No scraping, no impersonation.
//
// Official docs:
//   Facebook Login          https://developers.facebook.com/docs/facebook-login
//   Pages API — posts       https://developers.facebook.com/docs/pages-api/posts
//   IG Content Publishing    https://developers.facebook.com/docs/instagram-api/guides/content-publishing
//
// SANDBOX rule (the tested path): with no Meta creds configured, isLive() is
// false → getAuthUrl returns null, publish returns simulatedPublish, status
// just reads the store. Nothing here ever throws in sandbox mode.

const config = require('../config');
const { ConnectorError, connected, notConnected, simulatedPublish } = require('./base');

// Pin a versioned Graph API. Meta requires a version in the path; v21.0 is a
// current Graph version at time of writing. [UNVERIFIED] exact latest version.
const GRAPH_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
const DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

// Scopes requested for the combined Facebook + Instagram flow. pages_* cover
// Page listing + publishing; instagram_* cover IG account discovery + posting;
// business_management lets us enumerate assets the user manages.
const META_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
].join(',');

// ---------------------------------------------------------------------------
// Shared OAuth helpers (module-local, used by BOTH adapters)
// ---------------------------------------------------------------------------

// Redirect URI for a given adapter key. The start route registers
// `<redirectBase>/api/connect/<key>/callback`; each adapter points OAuth back
// at its OWN callback so Meta echoes a redirect_uri that matches what we send
// during the code exchange (Meta requires the two to be identical).
function redirectUriFor(key) {
  return `${config.connectors.redirectBase}/api/connect/${key}/callback`;
}

function buildAuthUrl(key, state) {
  const c = config.connectors.meta;
  if (!c.clientId) return null;
  const url = new URL(DIALOG);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('redirect_uri', redirectUriFor(key));
  url.searchParams.set('scope', META_SCOPES);
  url.searchParams.set('response_type', 'code');
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

async function exchangeCodeForUserToken(code, key) {
  const c = config.connectors.meta;
  const params = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    redirect_uri: redirectUriFor(key),
    code,
  });
  let res;
  try {
    res = await fetch(`${GRAPH}/oauth/access_token?${params.toString()}`, { method: 'GET' });
  } catch (err) {
    throw new ConnectorError(key, `Could not reach Meta to exchange auth code (${err.message}).`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const msg = data && data.error && data.error.message ? data.error.message : 'token exchange failed';
    throw new ConnectorError(key, `Meta authorization failed: ${msg}`, res.status || 400);
  }
  return data.access_token;
}

// Discover the first manageable Page and its linked Instagram business account.
// GET /me/accounts?fields=name,access_token,instagram_business_account
// Docs: https://developers.facebook.com/docs/pages-api/get-started
async function discoverPageAndInstagram(userToken) {
  const params = new URLSearchParams({
    fields: 'name,access_token,instagram_business_account',
    access_token: userToken,
  });
  let res;
  try {
    res = await fetch(`${GRAPH}/me/accounts?${params.toString()}`, { method: 'GET' });
  } catch (err) {
    throw new ConnectorError('meta_facebook', `Could not reach Meta to list Pages (${err.message}).`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'could not list Facebook pages';
    throw new ConnectorError('meta_facebook', `Meta page discovery failed: ${msg}`, res.status || 400);
  }
  const pages = Array.isArray(data.data) ? data.data : [];
  if (pages.length === 0) return null;
  // [UNVERIFIED] accounts response item shape: { id, name, access_token,
  //   instagram_business_account: { id } } ], paging: {...} }
  const p = pages[0];
  return {
    pageId: String(p.id),
    pageName: p.name || 'Facebook Page',
    accessToken: p.access_token || userToken,
    igUserId: p.instagram_business_account ? p.instagram_business_account.id : null,
  };
}

// Best-effort fetch of an Instagram account's @username for a friendlier handle.
// GET /{ig-user-id}?fields=username  Docs: instagram-api basic fields.
async function fetchInstagramHandle(igUserId, pageToken) {
  try {
    const params = new URLSearchParams({ fields: 'username,name', access_token: pageToken });
    const res = await fetch(`${GRAPH}/${igUserId}?${params.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.username ? `@${data.username}` : (data.name || null);
  } catch {
    return null;
  }
}

// If user authed from an IG-first entry point, lookup which Page owns their IG
// (needed so the IG post can use the Page-scoped access token).
async function fetchPageIdForInstagram(igUserId, userToken) {
  // discoverPageAndInstagram already returns both from /me/accounts; kept for symmetry.
  const page = await discoverPageAndInstagram(userToken);
  return page && page.igUserId === igUserId ? page.pageId : null;
}

// Persist the combined OAuth payload. One Meta round trip writes BOTH
// the Page (Facebook) and, if linked, the IG business account (Instagram); we
// reuse the Page's access token for IG calls (standard Graph API requirement).
async function persistBothConnections({ db, profile, userToken }) {
  const page = await discoverPageAndInstagram(userToken);
  if (!page) {
    // User authorized Facebook Login, but manages zero Pages.
    throw new ConnectorError(
      'meta_facebook',
      'No Facebook Pages found under this account — create or be added as admin to a Page first, then reconnect.',
      400
    );
  }

  // Facebook connection
  db.connections.upsert({
    profileId: profile.id,
    platform: 'meta_facebook',
    accountId: page.pageId,
    accountHandle: page.pageName,
    accessToken: page.accessToken,
    status: 'connected',
    meta: { pageId: page.pageId, pageName: page.pageName },
  });

  // Instagram connection — only if the Page has a linked IG business account.
  if (page.igUserId) {
    const igHandle = await fetchInstagramHandle(page.igUserId, page.accessToken);
    db.connections.upsert({
      profileId: profile.id,
      platform: 'meta_instagram',
      accountId: page.igUserId,
      accountHandle: igHandle || `IG Business (${page.igUserId})`,
      accessToken: page.accessToken,
      status: 'connected',
      meta: { igUserId: page.igUserId, pageId: page.pageId },
    });
  }
}

// ---------------------------------------------------------------------------
// Facebook Pages adapter
// ---------------------------------------------------------------------------

const facebook = {
  key: 'meta_facebook',
  label: 'Facebook Page',
  authType: 'oauth',
  docsUrl: 'https://developers.facebook.com/docs/pages-api/posts',
  requirements: [
    'A Facebook Page you administer',
    'Admin/Editor access to that Page',
  ],
  howToConnect: [
    'Press Connect here and log in with your Facebook account.',
    'Select the Facebook Page you want Markivo to post to.',
    'Tick all permissions so Markivo can draft and publish posts.',
  ],
  group: 'meta',

  isLive: () => config.connectors.meta.enabled,

  getAuthUrl({ state }) {
    if (!this.isLive()) return null;
    return buildAuthUrl(this.key, state);
  },

  async handleCallback({ db, profile, query }) {
    if (!this.isLive()) throw new ConnectorError(this.key, 'Meta is not configured for live connections.', 400);
    if (!query || !query.code) throw new ConnectorError(this.key, 'Missing authorisation code from Meta.', 400);
    const userToken = await exchangeCodeForUserToken(query.code, this.key);
    // One callback persists BOTH the Facebook and Instagram rows (shared OAuth).
    await persistBothConnections({ db, profile, userToken });
    return await this.status({ db, profile });
  },

  async status({ db, profile }) {
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn) return notConnected(this);
    return connected(this, {
      accountHandle: conn.accountHandle,
      pageId: conn.meta ? conn.meta.pageId : conn.accountId,
    });
  },

  // Publish a feed post to the connected Facebook Page.
  // POST /{page-id}/feed { message, access_token } -> { id: '<post-id>' }
  // Docs: https://developers.facebook.com/docs/pages-api/posts#publishing
  async publish({ db, profile, text }) {
    if (!this.isLive()) return simulatedPublish(this);
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(this);

    const pageId = (conn.meta && conn.meta.pageId) || conn.accountId;
    const token = conn.accessToken;

    const params = new URLSearchParams({ message: text || '', access_token: token });
    let res;
    try {
      res = await fetch(`${GRAPH}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
    } catch (err) {
      throw new ConnectorError(this.key, `Could not reach Facebook to publish the post (${err.message}).`, 502);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      // [UNVERIFIED] error response shape: { error: { message, type, code, fbtrace_id } }
      const msg = data && data.error && data.error.message ? data.error.message : 'publishing failed';
      throw new ConnectorError(this.key, `Facebook publish failed: ${msg}`, res.status || 400);
    }
    return { simulated: false, platform: this.key, externalId: data.id, target: conn.accountHandle || pageId };
  },

  async disconnect({ db, profile }) {
    db.connections.remove(profile.id, this.key);
  },

  async metrics() {
    return null;
  },
};

// ---------------------------------------------------------------------------
// Instagram adapter
// ---------------------------------------------------------------------------

const instagram = {
  key: 'meta_instagram',
  label: 'Instagram',
  authType: 'oauth',
  docsUrl: 'https://developers.facebook.com/docs/instagram-api/guides/content-publishing',
  requirements: [
    'An Instagram Professional account (Business or Creator)',
    'That account linked to a Facebook Page you administer',
    'A photo or video for every post — Instagram has no text-only post',
  ],
  howToConnect: [
    'In the Instagram app: Settings → Account type → switch to Business or Creator.',
    'Still in Instagram settings, link the account to your Facebook Page.',
    'Press Connect here and sign in with that Facebook account.',
    'Tick both the Page and the linked Instagram account on the permissions screen.',
  ],
  group: 'meta',

  isLive: () => config.connectors.meta.enabled,

  // Instagram rides the SAME Meta consent. Point its auth URL at the shared
  // flow but keep this adapter's own callback key so redirect_uri matches on
  // the exchange. The Facebook callback persists both rows; if the user starts
  // from the Instagram card, this callback does the same via handleCallback.
  getAuthUrl({ state }) {
    if (!this.isLive()) return null;
    return buildAuthUrl(this.key, state);
  },

  async handleCallback({ db, profile, query }) {
    if (!this.isLive()) throw new ConnectorError(this.key, 'Meta is not configured for live connections.', 400);
    if (!query || !query.code) throw new ConnectorError(this.key, 'Missing authorisation code from Meta.', 400);
    const userToken = await exchangeCodeForUserToken(query.code, this.key);
    await persistBothConnections({ db, profile, userToken });
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn) {
      // Meta login succeeded but the Page has no linked IG business account.
      throw new ConnectorError(this.key, 'No Instagram Business account is linked to your Facebook Page — link one in your IG settings, then reconnect.', 400);
    }
    return await this.status({ db, profile });
  },

  async status({ db, profile }) {
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn) return notConnected(this);
    return connected(this, {
      accountHandle: conn.accountHandle,
      igUserId: conn.meta ? conn.meta.igUserId : conn.accountId,
      // IG requires an image — surface that the account can post media.
      ready: !!conn.accessToken,
    });
  },

  // Publish an Instagram image post. IG has NO text-only posts — an image_url
  // is mandatory. Two-step: create a media container, then publish it.
  //   POST /{ig-user-id}/media { caption, image_url, access_token } -> creation_id
  //   POST /{ig-user-id}/media_publish { creation_id, access_token } -> id
  // Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
  async publish({ db, profile, text, mediaUrl }) {
    if (!this.isLive()) return simulatedPublish(this);
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(this);

    if (!mediaUrl) {
      throw new ConnectorError(this.key, 'Instagram posts need an image — text-only is not supported by the API.', 400);
    }

    const igUserId = (conn.meta && conn.meta.igUserId) || conn.accountId;
    const token = conn.accessToken;

    // Step 1 — create the media container.
    let creationId;
    {
      const params = new URLSearchParams({ caption: text || '', image_url: mediaUrl, access_token: token });
      let res;
      try {
        res = await fetch(`${GRAPH}/${igUserId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
      } catch (err) {
        throw new ConnectorError(this.key, `Could not reach Instagram to upload the image (${err.message}).`, 502);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        // [UNVERIFIED] container response: { id: '<creation-id>' }
        const msg = data && data.error && data.error.message ? data.error.message : 'media container creation failed';
        throw new ConnectorError(this.key, `Instagram upload failed: ${msg}`, res.status || 400);
      }
      creationId = data.id;
    }

    // Step 2 — publish the container.
    {
      const params = new URLSearchParams({ creation_id: creationId, access_token: token });
      let res;
      try {
        res = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
      } catch (err) {
        throw new ConnectorError(this.key, `Could not reach Instagram to publish the post (${err.message}).`, 502);
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        // [UNVERIFIED] publish response: { id: '<media-id>' }
        const msg = data && data.error && data.error.message ? data.error.message : 'Instagram rejected the post';
        throw new ConnectorError(this.key, `Instagram publish failed: ${msg}`, res.status || 400);
      }
      return { simulated: false, platform: this.key, externalId: data.id, target: conn.accountHandle || igUserId };
    }
  },

  async disconnect({ db, profile }) {
    db.connections.remove(profile.id, this.key);
  },

  async metrics() {
    return null;
  },
};

// ---------------------------------------------------------------------------
// Business Discovery — read a PUBLIC Business/Creator account's own recent
// media (captions, engagement) via the Graph API feature built for exactly
// this (competitor/benchmark analysis): no scraping, no login as them, no
// authorization needed FROM them. Requires the CALLING business's OWN
// meta_instagram connection (the OAuth above) — the target does not have to
// grant us anything, but does have to be a public Business or Creator
// account itself (personal accounts are not queryable this way).
//   GET /{caller-ig-user-id}?fields=business_discovery.username({target}){...}
// Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/business-discovery
// [UNVERIFIED] full field list for business_discovery.media in the current
// API version — comments_count/like_count/id are docs-confirmed at write
// time; caption/media_type/timestamp/permalink are the commonly-documented
// IG Media node fields but weren't freshly re-verified against this exact
// endpoint. An unsupported field can fail the WHOLE call — callers must treat
// any failure here as "unavailable" and fall back, never surface it raw.
async function businessDiscovery(callerIgUserId, targetUsername, accessToken, { fetchImpl = fetch, limit = 25 } = {}) {
  const mediaFields = 'caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  const fields = `business_discovery.username(${targetUsername}){username,name,profile_picture_url,followers_count,media_count,media.limit(${limit}){${mediaFields}}}`;
  const params = new URLSearchParams({ fields, access_token: accessToken });
  let res;
  try {
    res = await fetchImpl(`${GRAPH}/${callerIgUserId}?${params.toString()}`, { method: 'GET' });
  } catch (err) {
    throw new ConnectorError('meta_instagram', `Could not reach Instagram Business Discovery (${err.message}).`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.business_discovery) {
    const msg = data && data.error && data.error.message ? data.error.message : 'business_discovery unavailable for this account';
    throw new ConnectorError('meta_instagram', `Business Discovery failed: ${msg}`, res.status || 400);
  }
  return data.business_discovery;
}

// ---------------------------------------------------------------------------
// Own-account reads (Autopilot's "what has THIS business actually posted"
// signal) — a plain GET on a resource the connected account already owns, no
// extra permission beyond the pages_read_engagement/instagram_basic scopes
// already requested at connect time (see META_SCOPES above).
// ---------------------------------------------------------------------------

// GET /{ig-user-id}/media — the account's own recent media, real captions +
// engagement. Docs: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
async function ownMedia(igUserId, accessToken, { fetchImpl = fetch, limit = 25 } = {}) {
  const fields = 'caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count';
  const params = new URLSearchParams({ fields, access_token: accessToken, limit: String(limit) });
  let res;
  try {
    res = await fetchImpl(`${GRAPH}/${igUserId}/media?${params.toString()}`, { method: 'GET' });
  } catch (err) {
    throw new ConnectorError('meta_instagram', `Could not reach Instagram to read your own posts (${err.message}).`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'could not read your Instagram media';
    throw new ConnectorError('meta_instagram', `Instagram own-media read failed: ${msg}`, res.status || 400);
  }
  return Array.isArray(data.data) ? data.data : [];
}

// GET /{page-id}/posts — the Page's own recent posts, with like/comment
// summaries. Docs: https://developers.facebook.com/docs/pages-api/posts
async function ownPagePosts(pageId, accessToken, { fetchImpl = fetch, limit = 25 } = {}) {
  const fields = 'message,created_time,permalink_url,likes.summary(true),comments.summary(true)';
  const params = new URLSearchParams({ fields, access_token: accessToken, limit: String(limit) });
  let res;
  try {
    res = await fetchImpl(`${GRAPH}/${pageId}/posts?${params.toString()}`, { method: 'GET' });
  } catch (err) {
    throw new ConnectorError('meta_facebook', `Could not reach Facebook to read your own posts (${err.message}).`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.error && data.error.message ? data.error.message : 'could not read your Page posts';
    throw new ConnectorError('meta_facebook', `Facebook own-posts read failed: ${msg}`, res.status || 400);
  }
  return Array.isArray(data.data) ? data.data : [];
}

module.exports = { instagram, facebook, businessDiscovery, ownMedia, ownPagePosts };
