// Google Business Profile adapter — publishes "local posts" (the updates that
// appear on a business's Google Search / Maps listing) through Google's OFFICIAL
// Business Profile API, on the owner's behalf. Never scrapes, never impersonates.
//
// It shares ONE Google OAuth client with the YouTube adapter (config.connectors
// .google) — a single Google Cloud project, two scopes. This adapter requests
// only `business.manage`; YouTube requests its own upload scope.
//
// Docs:
//   OAuth 2.0 (web server flow):
//     https://developers.google.com/identity/protocols/oauth2/web-server
//   Account management (find the account):
//     https://developers.google.com/my-business/reference/rest/account-management
//   Local posts (publish):
//     https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts
//
// IMPORTANT compliance note: the v4 `accounts.locations.localPosts` endpoint is
// part of the LEGACY Business Profile API and is ACCESS-GATED / ALLOWLISTED by
// Google — a project must apply for and be granted access before these calls
// return anything but 403. Until granted, LIVE publish will fail with a 403 and
// surface as a friendly ConnectorError. Sandbox mode never touches the network.
//
// Sandbox rule (Markivo-wide): a BLANK Google credential must never break the
// app or the tests. With no creds, getAuthUrl() returns null, status() reads the
// store, and publish() returns a simulated result — nothing throws.

const config = require('../config');
const { ConnectorError, connected, notConnected, simulatedPublish } = require('./base');

// --- Endpoints (module-local) ---
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Account Management API (v1) — used to discover the business account.
const ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
// Legacy v4 base — local posts live here (allowlisted access required).
const MYBUSINESS_V4 = 'https://mybusiness.googleapis.com/v4';
// Single scope: manage the owner's Business Profile.
const SCOPE = 'https://www.googleapis.com/auth/business.manage';

const adapter = {
  key: 'google_business',
  label: 'Google Business Profile',
  group: 'google',

  authType: 'oauth',
  docsUrl: 'https://developers.google.com/my-business/content/posts-data',
  requirements: [
    'A Google Business Profile listing for your business',
    'The listing VERIFIED by Google (postcard, phone, or email)',
    'Owner or manager access on the Google account you sign in with',
  ],
  howToConnect: [
    'Claim your listing at business.google.com if you have not already.',
    'Finish Google’s verification — unverified listings cannot receive posts.',
    'Press Connect and sign in with the Google account that owns the listing.',
    'Approve the Business Profile permission, then pick the location to post to.',
  ],

  // Live when the SHARED Google OAuth client is configured (clientId + secret).
  isLive: () => config.connectors.google.enabled,

  // OAuth consent URL. SANDBOX (no creds): return null — the start route
  // simulates the connect. The redirect URI must exactly match the one
  // registered in the Google Cloud console for this client.
  getAuthUrl({ state }) {
    if (!this.isLive()) return null;
    const { clientId } = config.connectors.google;
    const redirectUri = `${config.connectors.redirectBase}/api/connect/${this.key}/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      // offline + consent => Google returns a refresh_token we can persist.
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPE,
      state,
    });
    return `${OAUTH_AUTH_URL}?${params.toString()}`;
  },

  // Exchange the authorization code for tokens, best-effort discover the
  // business account, persist, then report status. LIVE only.
  async handleCallback({ db, profile, query }) {
    const { clientId, clientSecret } = config.connectors.google;
    const redirectUri = `${config.connectors.redirectBase}/api/connect/${this.key}/callback`;

    if (query && query.error) {
      throw new ConnectorError(this.key, `Google denied the connection (${query.error}).`, 400);
    }
    const code = query && query.code;
    if (!code) throw new ConnectorError(this.key, 'Google did not return an authorization code.', 400);

    // --- 1) Code -> tokens ---
    // POST https://oauth2.googleapis.com/token (web server flow). [UNVERIFIED] response shape.
    let tokens;
    try {
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      tokens = await res.json().catch(() => ({}));
      if (!res.ok || !tokens.access_token) {
        const detail = (tokens && (tokens.error_description || tokens.error)) || `HTTP ${res.status}`;
        throw new ConnectorError(this.key, `Google token exchange failed: ${detail}`, res.status || 502);
      }
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not reach Google to complete the connection.', 502);
    }

    const accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token || null;
    // expires_in is seconds-from-now; store an absolute ISO timestamp.
    const tokenExpiresAt = tokens.expires_in
      ? new Date(Date.now() + Number(tokens.expires_in) * 1000).toISOString()
      : null;

    // --- 2) Best-effort: discover the business account ---
    // GET https://mybusinessaccountmanagement.googleapis.com/v1/accounts
    // Response: { accounts: [ { name: "accounts/123", accountName: "...", ... } ] }. [UNVERIFIED]
    // We pick the first account. Location selection is a later step (see publish):
    // the owner must choose which listing to post to, since one account can own
    // many locations and Markivo must not guess.
    let account = null;
    let accountHandle = null;
    try {
      const res = await fetch(ACCOUNTS_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await res.json().catch(() => ({}));
      const first = res.ok && Array.isArray(body.accounts) ? body.accounts[0] : null;
      if (first) {
        account = first.name || null; // "accounts/{accountId}"
        accountHandle = first.accountName || first.name || null;
      }
    } catch {
      // Non-fatal: account discovery is access-gated and may 403. We still store
      // the tokens so the connection exists; location can be resolved later.
    }

    db.connections.upsert({
      profileId: profile.id,
      platform: this.key,
      status: 'connected',
      accountHandle,
      accountId: account, // the account resource name "accounts/{id}"
      accessToken,
      refreshToken,
      tokenExpiresAt,
      scopes: SCOPE,
      // location stays null until the owner picks a listing; the dashboard's
      // location picker will write meta.location = "accounts/{a}/locations/{l}".
      meta: { account, location: null },
    });

    return this.status({ db, profile });
  },

  async status({ db, profile }) {
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn) return notConnected(this);
    const meta = conn.meta || {};
    // Ready to publish only once a specific location/listing has been selected.
    const ready = !!meta.location;
    return connected(this, {
      accountHandle: conn.accountHandle,
      account: meta.account || conn.accountId || null,
      location: meta.location || null,
      // Surfaced so the dashboard can prompt the owner to pick a listing.
      needsLocation: !meta.location,
      ready,
    });
  },

  // Publish a Google "local post" to the selected listing.
  async publish({ db, profile, text }) {
    if (!this.isLive()) return simulatedPublish(this);
    const conn = db.connections.findByProfile(profile.id, this.key);
    if (!conn || conn.status === 'sandbox' || !conn.accessToken) return simulatedPublish(this);

    const meta = conn.meta || {};
    // `parent` = accounts/{a}/locations/{l}. Without it we cannot target a
    // listing — the owner must select one in the dashboard first.
    const parent = meta.location;
    if (!parent) {
      throw new ConnectorError(
        this.key,
        'Pick which Google Business listing to post to first — open the Google Business card on your dashboard and select a location.',
        400,
      );
    }

    // POST https://mybusiness.googleapis.com/v4/{parent}/localPosts
    // Body (STANDARD update post): { languageCode, summary, topicType }. [UNVERIFIED] exact field set.
    // NOTE: this v4 endpoint is allowlisted — un-granted projects get 403 here.
    const url = `${MYBUSINESS_V4}/${parent}/localPosts`;
    let created;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${conn.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          languageCode: 'en',
          summary: text,
          topicType: 'STANDARD',
        }),
      });
      created = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (created && created.error && created.error.message) || `HTTP ${res.status}`;
        // 403 here almost always means the project is not yet allowlisted for
        // the legacy Business Profile API — make that actionable.
        const msg = res.status === 403
          ? `Google rejected the post (${detail}). The Business Profile "local posts" API is access-gated — this project must be granted access by Google before posting works.`
          : `Google Business post failed: ${detail}`;
        throw new ConnectorError(this.key, msg, res.status || 502);
      }
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      throw new ConnectorError(this.key, 'Could not reach Google to publish the post.', 502);
    }

    // Created post resource name, e.g. "accounts/{a}/locations/{l}/localPosts/{p}". [UNVERIFIED]
    const externalId = created.name || null;
    return { simulated: false, platform: this.key, externalId, target: conn.accountHandle || parent };
  },

  async disconnect({ db, profile }) {
    db.connections.remove(profile.id, this.key);
  },

  // Reviews / listing insights are a later milestone — nothing to report yet.
  async metrics() {
    return null;
  },
};

module.exports = adapter;
