// TikTok adapter — connect a TikTok account via Login Kit and publish videos via
// the Content Posting API, always through TikTok's OFFICIAL endpoints and on the
// user's behalf (never scraping or impersonating).
//
//   Login Kit (Web):        https://developers.tiktok.com/doc/login-kit-web
//   Content Posting API:    https://developers.tiktok.com/doc/content-posting-api-get-started
//
// TikTok is VIDEO-only: there is no text-only or image post on the public API, so
// a live publish without a video URL is rejected with a clear ConnectorError.
//
// IMPORTANT distinction from the other adapters: TikTok's OAuth uses `client_key`
// / `client_secret` (NOT `client_id`). config.connectors.tiktok exposes
// { clientKey, clientSecret, enabled } accordingly.
//
// Markivo rule: a BLANK credential must never break the app or the tests. When
// tiktok.enabled is false the adapter runs in deterministic SANDBOX mode —
// connect is simulated (getAuthUrl => null), publish returns simulatedPublish,
// and status simply reads the connection store.

const config = require('../config');
const { ConnectorError, connected, notConnected, simulatedPublish } = require('./base');

// TikTok Open API hosts. Login consent lives on tiktok.com; token + data calls
// live on open.tiktokapis.com. The Open API is versioned with a /v2/ path.
const AUTH_HOST = 'https://www.tiktok.com/v2/auth/authorize/';
const API_HOST = 'https://open.tiktokapis.com/v2';

// Scopes needed to upload + publish a video on the owner's behalf.
//   video.upload  — stage a video into the user's TikTok inbox/draft
//   video.publish — direct-post (requires an audited app; see publish())
const SCOPES = 'video.publish,video.upload';

const redirectUri = (key) => `${config.connectors.redirectBase}/api/connect/${key}/callback`;

const adapter = {
  key: 'tiktok',
  label: 'TikTok',
  group: 'tiktok',

  authType: 'oauth',
  docsUrl: 'https://developers.tiktok.com/doc/login-kit-web',
  requirements: [
    'A TikTok account',
    'A video for every post — TikTok has no text-only or image post',
  ],
  howToConnect: [
    'Press Connect — we send you to TikTok’s official login screen.',
    'Sign in and approve the video upload permission.',
    'TikTok sends you back here and the account shows as connected.',
    'Until TikTok audits the app, posts land in your TikTok drafts for a final tap.',
  ],

  // "Live" only when real Login Kit credentials are configured.
  isLive: () => config.connectors.tiktok.enabled,

  // Build the Login Kit consent URL. In sandbox (no creds) we return null and the
  // start route simulates the connect.
  // Docs: https://developers.tiktok.com/doc/login-kit-web
  getAuthUrl({ state }) {
    if (!this.isLive()) return null;
    const params = new URLSearchParams({
      client_key: config.connectors.tiktok.clientKey,
      redirect_uri: redirectUri(this.key),
      response_type: 'code',
      scope: SCOPES,
      state: state || '',
    });
    return `${AUTH_HOST}?${params.toString()}`;
  },

  // Exchange the authorization code for tokens, persist, return live status.
  // Token endpoint (form-urlencoded):
  //   POST https://open.tiktokapis.com/v2/oauth/token/
  // Docs: https://developers.tiktok.com/doc/oauth-user-access-token-management
  async handleCallback({ db, profile, query }) {
    if (!this.isLive()) throw new ConnectorError(this.key, 'TikTok is not configured for live mode.', 400);
    const code = query && query.code;
    if (!code) throw new ConnectorError(this.key, 'TikTok did not return an authorization code.', 400);

    let token;
    try {
      const body = new URLSearchParams({
        client_key: config.connectors.tiktok.clientKey,
        client_secret: config.connectors.tiktok.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri(this.key),
      });
      const res = await fetch(`${API_HOST}/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      token = await res.json();
      // TikTok returns 200 with an `error` string on failure rather than a 4xx.
      if (!res.ok || token.error) {
        const msg = token.error_description || token.error || `HTTP ${res.status}`;
        throw new ConnectorError(this.key, `TikTok sign-in failed: ${msg}`, 400);
      }
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not reach TikTok to finish sign-in. Please try again.', 502);
    }

    // [UNVERIFIED] token payload shape: access_token, refresh_token, expires_in
    // (seconds), open_id, scope. open_id is TikTok's stable per-app user id.
    const openId = token.open_id || null;
    const expiresAt = token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;

    // Best-effort handle lookup — optional, never blocks the connect.
    // Docs: https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info
    let handle = null;
    try {
      if (token.access_token) {
        const infoRes = await fetch(`${API_HOST}/user/info/?fields=open_id,username,display_name`, {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const info = await infoRes.json();
        // [UNVERIFIED] shape: { data: { user: { username, display_name } } }
        const user = info && info.data && info.data.user;
        if (user) handle = user.username ? `@${user.username}` : user.display_name || null;
      }
    } catch {
      // Handle is cosmetic; ignore failures and keep the connection.
    }

    db.connections.upsert({
      profileId: profile.id,
      platform: this.key,
      status: 'connected',
      accountHandle: handle,
      accountId: openId,
      accessToken: token.access_token || null,
      refreshToken: token.refresh_token || null,
      tokenExpiresAt: expiresAt,
      scopes: token.scope || SCOPES,
      meta: { openId },
    });

    return this.status({ db, profile });
  },

  async status({ db, profile }) {
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn) return notConnected(this);
    // Ready to post when live with a real token (sandbox connections carry no token).
    const ready = this.isLive() && conn.status !== 'sandbox' && !!conn.accessToken;
    return connected(this, {
      accountHandle: conn.accountHandle,
      mediaRequired: 'video',
      ready,
    });
  },

  // Publish a video. TikTok has no text-only / image post on the public API.
  // Direct Post via PULL_FROM_URL (TikTok fetches the hosted video itself):
  //   POST https://open.tiktokapis.com/v2/post/publish/video/init/
  // NOTE: direct posting (auto-publish without the in-app review screen) requires
  // an AUDITED app with the video.publish scope approved by TikTok; unaudited apps
  // can only stage to the user's drafts. We attempt Direct Post and surface
  // TikTok's error verbatim if the app is not yet audited.
  // Docs: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
  async publish({ db, profile, text, mediaUrl }) {
    if (!this.isLive()) return simulatedPublish(this);
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(this);

    if (!mediaUrl) {
      throw new ConnectorError(this.key, 'TikTok posts require a video.', 400);
    }

    let result;
    try {
      const payload = {
        // [UNVERIFIED] title max length / privacy fields; title carries the caption.
        post_info: { title: text || '' },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: mediaUrl,
        },
      };
      const res = await fetch(`${API_HOST}/post/publish/video/init/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify(payload),
      });
      result = await res.json();
      // TikTok wraps status in `error.code` === 'ok' on success.
      const errCode = result && result.error && result.error.code;
      if (!res.ok || (errCode && errCode !== 'ok')) {
        const msg = (result && result.error && result.error.message) || `HTTP ${res.status}`;
        throw new ConnectorError(this.key, `TikTok rejected the post: ${msg}`, res.status >= 400 ? res.status : 400);
      }
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not reach TikTok to publish the video. Please try again.', 502);
    }

    // [UNVERIFIED] success shape: { data: { publish_id }, error: { code:'ok' } }.
    const publishId = (result && result.data && result.data.publish_id) || null;
    return { simulated: false, platform: this.key, externalId: publishId, target: conn.accountHandle || 'TikTok' };
  },

  async disconnect({ db, profile }) {
    db.connections.remove(profile.id, this.key);
  },

  // TikTok analytics require additional scopes/audit; not surfaced here.
  async metrics() {
    return null;
  },
};

module.exports = adapter;
