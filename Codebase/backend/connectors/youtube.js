// YouTube adapter — connect a Google account's YouTube channel and "publish" by
// uploading a video through the official YouTube Data API v3, on the user's
// behalf, behind Markivo's human approval gate. Never scrapes, never impersonates.
//
// SHARED Google OAuth: YouTube and Google Business Profile both authenticate with
// ONE Google Cloud OAuth client (config.connectors.google). Each adapter requests
// its own scopes and registers its own redirect URI; the client id/secret is the
// same. This adapter is therefore gated by config.connectors.google.enabled.
//
// Official docs this adapter follows:
//   OAuth 2.0 (web server flow):
//     https://developers.google.com/identity/protocols/oauth2/web-server
//   Data API — videos.insert (upload):
//     https://developers.google.com/youtube/v3/docs/videos/insert
//   Data API — channels.list:
//     https://developers.google.com/youtube/v3/docs/channels/list
//
// IMPORTANT on "posting" to YouTube: a YouTube post = uploading a VIDEO. There is
// NO official, generally-available API for the community-tab text/image posts you
// see on a channel, so this adapter cannot create text-only community posts. In
// LIVE mode, publishing without a video (mediaUrl) is rejected with a clear error.
//
// SANDBOX rule: with no Google credentials the adapter simulates connect/publish
// and reads status from the store — it must never throw. That is the tested path.

const config = require('../config');
const { ConnectorError, connected, notConnected, simulatedPublish } = require('./base');

// --- Google / YouTube endpoints -------------------------------------------------
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YT_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';
// Resumable upload endpoint (videos.insert). The first request sends metadata and
// returns an upload session URL in the `Location` header; the bytes go in step 2.
const YT_UPLOAD_URL = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

// Upload lets us post; readonly lets us read the channel + statistics for metrics.
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
];

// Markivo builds every redirect URI as `<redirectBase>/api/connect/<key>/callback`.
const redirectUri = (key) => `${config.connectors.redirectBase}/api/connect/${key}/callback`;

const adapter = {
  key: 'youtube',
  label: 'YouTube',

  authType: 'oauth',
  docsUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
  requirements: [
    'A YouTube channel on the Google account you sign in with',
    'A video file for every post — YouTube publishes video only',
  ],
  howToConnect: [
    'Create your channel at youtube.com/create_channel if you have not already.',
    'Press Connect and sign in with that Google account.',
    'Approve the YouTube upload permission on Google’s consent screen.',
    'Google sends you back here and the channel shows as connected.',
  ],

  // Shares the Google OAuth client (and thus the dashboard "Google" grouping)
  // with the Google Business Profile adapter.
  group: 'google',

  // Live only when the shared Google OAuth client is configured.
  isLive: () => config.connectors.google.enabled,

  // OAuth 2.0 web-server consent URL.
  // https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient
  // access_type=offline + prompt=consent => Google returns a refresh_token so we
  // can keep uploading after the access token expires.
  getAuthUrl({ state }) {
    if (!this.isLive()) return null; // SANDBOX: the start route simulates the connect.
    const params = new URLSearchParams({
      client_id: config.connectors.google.clientId,
      redirect_uri: redirectUri(this.key),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      scope: SCOPES.join(' '),
      state: state || '',
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  },

  // Exchange the authorization code for tokens, look up the channel, and persist.
  async handleCallback({ db, profile, query }) {
    if (!this.isLive()) return this.status({ db, profile });
    const code = query && query.code;
    if (!code) throw new ConnectorError(this.key, 'YouTube authorization was cancelled or returned no code.', 400);

    // Step 1: code -> tokens (standard Google token exchange).
    // POST application/x-www-form-urlencoded to the token endpoint. [UNVERIFIED] field names per docs.
    let tokens;
    try {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.connectors.google.clientId,
          client_secret: config.connectors.google.clientSecret,
          redirect_uri: redirectUri(this.key),
          grant_type: 'authorization_code',
        }).toString(),
      });
      tokens = await res.json();
      if (!res.ok || !tokens.access_token) {
        throw new ConnectorError(this.key, tokens.error_description || 'Google rejected the YouTube token exchange.', 400);
      }
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not reach Google to complete YouTube sign-in.', 502);
    }

    // Step 2: identify the user's channel.
    // GET channels?part=snippet&mine=true
    // https://developers.google.com/youtube/v3/docs/channels/list
    let channel;
    try {
      const url = `${YT_CHANNELS_URL}?part=snippet&mine=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const body = await res.json();
      if (!res.ok) {
        throw new ConnectorError(this.key, (body.error && body.error.message) || 'Could not read your YouTube channel.', 400);
      }
      // [UNVERIFIED] response shape: { items: [{ id, snippet: { title, ... } }] }.
      channel = body.items && body.items[0];
      if (!channel) {
        throw new ConnectorError(this.key, 'This Google account has no YouTube channel — create one, then reconnect.', 400);
      }
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not read your YouTube channel from Google.', 502);
    }

    const channelId = channel.id;
    const channelTitle = (channel.snippet && channel.snippet.title) || 'YouTube channel';

    // Persist (tokens are encrypted at rest by the db layer; we pass plaintext).
    // Google returns expires_in (seconds); convert to an absolute ms timestamp.
    const tokenExpiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null;
    db.connections.upsert({
      profileId: profile.id,
      platform: this.key,
      status: 'connected',
      accountHandle: channelTitle,
      accountId: channelId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      tokenExpiresAt,
      scopes: SCOPES.join(' '),
      meta: { channelId },
    });

    return this.status({ db, profile });
  },

  async status({ db, profile }) {
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn) return notConnected(adapter);
    return connected(adapter, {
      accountHandle: conn.accountHandle,
      channelId: (conn.meta && conn.meta.channelId) || conn.accountId || null,
      // Ready to upload only when we hold a live access token (not a sandbox stub).
      ready: conn.status !== 'sandbox' && !!conn.accessToken,
    });
  },

  // "Publish" to YouTube = upload a video. There is no official API for community
  // text/image posts, so a text-only publish cannot go live — see header note.
  async publish({ db, profile, text, mediaUrl }) {
    if (!this.isLive()) return simulatedPublish(adapter);
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(adapter);

    // YouTube has no text-only post API — a video file is mandatory in LIVE mode.
    if (!mediaUrl) {
      throw new ConnectorError(this.key, 'YouTube requires a video file to publish; community text posts have no API.', 400);
    }

    // videos.insert via resumable upload.
    // https://developers.google.com/youtube/v3/docs/videos/insert#usage
    // Title comes from the first line of the caption; the full caption becomes the
    // description. Privacy defaults to 'public' (the human approval gate already ran).
    const firstLine = (text || '').split('\n')[0].trim();
    const title = (firstLine || 'New video').slice(0, 100); // YouTube caps titles at 100 chars.
    const description = text || '';
    const snippetBody = {
      snippet: { title, description, categoryId: '22' }, // 22 = "People & Blogs". [UNVERIFIED] default category.
      status: { privacyStatus: 'public' },
    };

    try {
      // --- Step 1: open a resumable upload session (metadata only) ----------------
      // POST the JSON metadata; Google replies 200 with the session URL in `Location`.
      // We also declare the eventual content type/length so Google can validate.
      const fileRes = await fetch(mediaUrl);
      if (!fileRes.ok) {
        throw new ConnectorError(this.key, 'Could not fetch the video file to upload to YouTube.', 400);
      }
      const contentType = fileRes.headers.get('content-type') || 'video/*';
      const videoBuf = Buffer.from(await fileRes.arrayBuffer());

      const initRes = await fetch(YT_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          // These X-Upload-* headers describe the bytes that step 2 will send.
          // [UNVERIFIED] exact header names per resumable-upload protocol.
          'X-Upload-Content-Type': contentType,
          'X-Upload-Content-Length': String(videoBuf.length),
        },
        body: JSON.stringify(snippetBody),
      });
      if (!initRes.ok) {
        const body = await initRes.json().catch(() => ({}));
        throw new ConnectorError(this.key, (body.error && body.error.message) || 'YouTube rejected the upload request.', initRes.status || 400);
      }
      const sessionUrl = initRes.headers.get('location');
      if (!sessionUrl) {
        throw new ConnectorError(this.key, 'YouTube did not return an upload session URL.', 502);
      }

      // --- Step 2: stream the video bytes to the session URL ----------------------
      // Best-effort single-shot PUT of the whole file. A production hardening would
      // chunk this and resume on 308 responses, but a one-shot PUT is valid for
      // files small enough to buffer and keeps the live path real, not stubbed.
      const putRes = await fetch(sessionUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Content-Length': String(videoBuf.length) },
        body: videoBuf,
      });
      const result = await putRes.json().catch(() => ({}));
      if (!putRes.ok || !result.id) {
        throw new ConnectorError(this.key, (result.error && result.error.message) || 'YouTube upload failed while sending the video.', putRes.status || 502);
      }

      return {
        simulated: false,
        platform: this.key,
        externalId: result.id, // the new video id
        target: conn.accountHandle || 'your YouTube channel',
      };
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not upload the video to YouTube right now.', 502);
    }
  },

  async disconnect({ db, profile }) {
    db.connections.remove(profile.id, this.key);
  },

  // Subscriber count via channels.list statistics (only meaningful when live).
  // https://developers.google.com/youtube/v3/docs/channels/list (part=statistics)
  async metrics({ db, profile }) {
    if (!this.isLive()) return null;
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn || conn.status === 'sandbox' || !conn.accessToken) return null;
    try {
      const url = `${YT_CHANNELS_URL}?part=statistics&mine=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${conn.accessToken}` } });
      if (!res.ok) return null;
      const body = await res.json();
      // [UNVERIFIED] shape: items[0].statistics.subscriberCount (string).
      const stats = body.items && body.items[0] && body.items[0].statistics;
      const subscribers = stats && stats.subscriberCount != null ? Number(stats.subscriberCount) : null;
      return subscribers != null && !Number.isNaN(subscribers) ? { subscribers } : null;
    } catch {
      return null;
    }
  },
};

module.exports = adapter;
