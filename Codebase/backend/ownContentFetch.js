const meta = require('./connectors/meta');
const youtube = require('./connectors/youtube');
const competitorFetch = require('./competitorFetch');

// ===========================================================================
// Own-content reads — Autopilot's "what has this business actually posted, on
// and off Markivo" signal, per connected platform. Distinct from
// competitorFetch.js (which reads STRANGERS' public content): here the caller
// already owns the account, so wherever a real read API/scope already exists
// from the connector's OWN OAuth grant (Meta, YouTube) we use it directly;
// where it doesn't (TikTok has no read scope, Telegram's Bot API has no
// "read channel history" method), we fall back to the exact same public-page
// scrape competitorFetch.js already uses — against the account's OWN public
// profile instead of a competitor's. Never throws, never invents data: every
// branch degrades to the same normalized empty/error shape.
// ===========================================================================

const normalizeResult = (overrides = {}) => ({
  found: false, posts: [], partial: true, error: null,
  ...overrides,
});

// DISABLED: SEO/Meta temporarily off — see 2026-08-13. connectors/meta.js
// exports {} while disabled, so guard explicitly instead of surfacing a raw
// "not a function" TypeError as this platform's error message.
async function fetchMetaInstagram(conn, opts) {
  if (!meta.ownMedia) return normalizeResult({ error: 'Instagram own-content reads are temporarily disabled' });
  if (!conn || !conn.accessToken) return normalizeResult({ error: 'Instagram is not connected' });
  const igUserId = (conn.meta && conn.meta.igUserId) || conn.accountId;
  try {
    const media = await meta.ownMedia(igUserId, conn.accessToken, opts);
    const posts = media.map((m) => ({
      externalId: m.id || null,
      kind: /video|reel/i.test(m.media_type || '') ? 'video' : 'photo',
      caption: m.caption || '',
      postedAt: m.timestamp || null,
      likeCount: Number.isFinite(+m.like_count) ? +m.like_count : null,
      commentCount: Number.isFinite(+m.comments_count) ? +m.comments_count : null,
      viewCount: null,
    }));
    return normalizeResult({ found: true, posts, partial: false });
  } catch (err) {
    return normalizeResult({ error: err.message });
  }
}

async function fetchMetaFacebook(conn, opts) {
  if (!meta.ownPagePosts) return normalizeResult({ error: 'Facebook own-content reads are temporarily disabled' });
  if (!conn || !conn.accessToken) return normalizeResult({ error: 'Facebook is not connected' });
  const pageId = (conn.meta && conn.meta.pageId) || conn.accountId;
  try {
    const raw = await meta.ownPagePosts(pageId, conn.accessToken, opts);
    const posts = raw.map((p) => ({
      externalId: p.id || null,
      kind: 'text',
      caption: p.message || '',
      postedAt: p.created_time || null,
      likeCount: Number.isFinite(+p.likes?.summary?.total_count) ? +p.likes.summary.total_count : null,
      commentCount: Number.isFinite(+p.comments?.summary?.total_count) ? +p.comments.summary.total_count : null,
      viewCount: null,
    }));
    return normalizeResult({ found: true, posts, partial: false });
  } catch (err) {
    return normalizeResult({ error: err.message });
  }
}

async function fetchYouTube(conn, opts) {
  if (!conn || !conn.accessToken) return normalizeResult({ error: 'YouTube is not connected' });
  try {
    const posts = await youtube.ownUploads(conn.accessToken, opts);
    return normalizeResult({ found: true, posts, partial: false });
  } catch (err) {
    return normalizeResult({ error: err.message });
  }
}

// TikTok's OAuth scopes (video.publish, video.upload) carry no read
// permission — adding one would force every connected user to reconnect.
// Reuse the same public-page scrape competitorFetch.js uses for competitors,
// pointed at the connected account's own public handle.
async function fetchTikTok(conn, opts) {
  const handle = (conn && conn.accountHandle) ? conn.accountHandle.replace(/^@/, '') : null;
  if (!handle) return normalizeResult({ error: 'No public TikTok handle on file for this account' });
  return competitorFetch.fetchTikTok(`https://www.tiktok.com/@${handle}`, opts);
}

// The Bot API has no "read channel history" method — a bot only ever
// receives messages from the point it joins, so historical posts are simply
// unreachable that way. When the linked chat has a public @username, reuse
// the same t.me/s/ preview scrape competitorFetch.js uses for competitors.
// Private channels/groups have no username and honestly report unavailable.
async function fetchTelegram(tgConn, opts) {
  if (!tgConn || !tgConn.chatUsername) {
    return normalizeResult({ error: 'This channel has no public username — Telegram gives no way to read its history otherwise' });
  }
  return competitorFetch.fetchTelegram(`https://t.me/s/${tgConn.chatUsername}`, opts);
}

const FETCHERS = {
  meta_instagram: (conn, _tgConn, opts) => fetchMetaInstagram(conn, opts),
  meta_facebook: (conn, _tgConn, opts) => fetchMetaFacebook(conn, opts),
  youtube: (conn, _tgConn, opts) => fetchYouTube(conn, opts),
  tiktok: (conn, _tgConn, opts) => fetchTikTok(conn, opts),
  telegram: (_conn, tgConn, opts) => fetchTelegram(tgConn, opts),
};

// Single entry point. `conn` is the platform's db.connections row (null for
// telegram, which has its own db.telegram row passed as `tgConn`). Never
// throws — an unknown platform or a fetcher failure degrades to the same
// normalized "not found" shape used throughout competitorFetch.js.
async function fetchOwnContent(platform, conn, tgConn, opts = {}) {
  const fn = FETCHERS[String(platform || '').toLowerCase()];
  if (!fn) return normalizeResult({ error: `No own-content reader for platform: ${platform}` });
  try {
    return await fn(conn, tgConn, opts);
  } catch (err) {
    return normalizeResult({ error: err.message });
  }
}

module.exports = { fetchOwnContent, SUPPORTED_PLATFORMS: Object.keys(FETCHERS) };
