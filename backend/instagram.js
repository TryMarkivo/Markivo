// Instagram client for the "Connect Instagram" OAuth flow, using the
// **Instagram API with Instagram Login** (Business Login, launched 2024) — NOT
// the older Facebook-Login Instagram Graph path. No SDK; plain HTTPS via fetch.
//
// Flow: dashboard sends the owner to buildAuthUrl() → instagram.com auth dialog →
// Instagram redirects back to our callback with ?code= → exchangeCodeForToken()
// (api.instagram.com) → exchangeForLongLivedToken() (graph.instagram.com) →
// resolveAccount() for the username. The long-lived token (~60 days) is stored
// encrypted (see db.instagram).
//
// Credentials are the **Instagram** app ID/secret (distinct from the Facebook
// app's), found under the app's Instagram product → API setup with Instagram
// login. Routes gate on config.instagramEnabled before calling in.

const config = require('./config');

const AUTH_BASE = 'https://www.instagram.com';
const API_BASE = 'https://api.instagram.com';
const GRAPH_BASE = 'https://graph.instagram.com';

class InstagramError extends Error {
  constructor(message, code, type) {
    super(`Instagram: ${message}`);
    this.name = 'InstagramError';
    this.code = code;
    this.type = type;
  }
}

// Instagram returns two error shapes: api.instagram.com → { error_type, code,
// error_message }; graph.instagram.com → { error: { message, type, code } }.
function throwIfError(data, status) {
  if (data && data.error) {
    throw new InstagramError(data.error.message || `HTTP ${status}`, data.error.code, data.error.type);
  }
  if (data && data.error_message) {
    throw new InstagramError(data.error_message, data.code, data.error_type);
  }
}

async function parseJson(res, label) {
  let data;
  try {
    data = await res.json();
  } catch {
    throw new InstagramError(`${label}: non-JSON response (HTTP ${res.status})`, res.status, 'parse');
  }
  throwIfError(data, res.status);
  if (!res.ok) throw new InstagramError(`${label}: HTTP ${res.status}`, res.status, 'http');
  return data;
}

/**
 * The Instagram auth-dialog URL the browser is redirected to. `state` is our
 * signed CSRF/identity token (see server.js signOauthState). redirect_uri must
 * match what's registered in the Instagram business-login settings.
 */
function buildAuthUrl(state) {
  const url = new URL(`${AUTH_BASE}/oauth/authorize`);
  url.searchParams.set('client_id', config.instagramAppId);
  url.searchParams.set('redirect_uri', config.instagramRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.instagramScopes);
  url.searchParams.set('state', state);
  return url.toString();
}

// Exchange the one-time ?code= for a short-lived token (POST, form-encoded).
// The redirect_uri must be byte-identical to the one used in buildAuthUrl.
async function exchangeCodeForToken(code) {
  let res;
  try {
    res = await fetch(`${API_BASE}/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.instagramAppId,
        client_secret: config.instagramAppSecret,
        grant_type: 'authorization_code',
        redirect_uri: config.instagramRedirectUri,
        code,
      }).toString(),
    });
  } catch (err) {
    throw new InstagramError(`network error (${err.message})`, 0, 'network');
  }
  const data = await parseJson(res, 'code exchange');
  // Newer responses may wrap the token node in a data[] array.
  const node = Array.isArray(data.data) ? data.data[0] : data;
  if (!node || !node.access_token) throw new InstagramError('no access_token in code exchange response', 0, 'oauth');
  return { accessToken: node.access_token, userId: node.user_id != null ? String(node.user_id) : null };
}

// Upgrade the short-lived token to a long-lived (~60-day) one.
async function exchangeForLongLivedToken(shortToken) {
  const url = new URL(`${GRAPH_BASE}/access_token`);
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', config.instagramAppSecret);
  url.searchParams.set('access_token', shortToken);

  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (err) {
    throw new InstagramError(`network error (${err.message})`, 0, 'network');
  }
  const data = await parseJson(res, 'long-lived exchange');
  if (!data.access_token) throw new InstagramError('no access_token in long-lived exchange response', 0, 'oauth');
  return { accessToken: data.access_token, expiresIn: data.expires_in || null };
}

/**
 * Resolve the connected account's username/id. No Facebook Page involved in this
 * flow — the token IS the Instagram account.
 */
async function resolveAccount(token) {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set('fields', 'user_id,username,account_type,name');
  url.searchParams.set('access_token', token);

  let res;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (err) {
    throw new InstagramError(`network error (${err.message})`, 0, 'network');
  }
  const me = await parseJson(res, 'account lookup');
  return {
    igUserId: me.user_id != null ? String(me.user_id) : (me.id != null ? String(me.id) : null),
    igUsername: me.username || null,
    pageId: null,
    accountName: me.name || me.username || null,
  };
}

// --- Content publishing (graph.instagram.com) ---
// Two-step flow: create a media container from a PUBLIC image URL, then publish
// it. Instagram fetches image_url server-side, so it must be reachable from the
// internet (JPEG); there is no text-only post type.

async function graphPost(pathname, params) {
  let res;
  try {
    res = await fetch(`${GRAPH_BASE}/${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  } catch (err) {
    throw new InstagramError(`network error (${err.message})`, 0, 'network');
  }
  return parseJson(res, 'publish');
}

// Step 1 — create an image media container; returns its creation id.
async function createMediaContainer(token, igUserId, { imageUrl, caption }) {
  const data = await graphPost(`${igUserId}/media`, {
    image_url: imageUrl,
    ...(caption ? { caption } : {}),
    access_token: token,
  });
  if (!data.id) throw new InstagramError('no container id in create-media response', 0, 'publish');
  return data.id;
}

// Step 2 — publish a previously-created container; returns the published media id.
async function publishMedia(token, igUserId, creationId) {
  const data = await graphPost(`${igUserId}/media_publish`, {
    creation_id: creationId,
    access_token: token,
  });
  if (!data.id) throw new InstagramError('no media id in media-publish response', 0, 'publish');
  return data.id;
}

// High-level: create + publish an image post for a stored connection.
async function publishImage(conn, { imageUrl, caption }) {
  const creationId = await createMediaContainer(conn.accessToken, conn.igUserId, { imageUrl, caption });
  const mediaId = await publishMedia(conn.accessToken, conn.igUserId, creationId);
  return { creationId, mediaId };
}

module.exports = {
  InstagramError,
  buildAuthUrl,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  resolveAccount,
  createMediaContainer,
  publishMedia,
  publishImage,
};
