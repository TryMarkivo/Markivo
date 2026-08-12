// Competitor metric enrichment.
//
// Google Places gives a competitor's name, rating and address. It does not give
// follower counts or posting cadence, and no API we can call will hand those
// over for an arbitrary business. What CAN be measured is whatever the
// competitor themselves published on a channel we already hold credentials for
// — today that means a public Telegram channel, read with the owner's own bot.
//
// Every adapter returns either measured fields WITH provenance, or a reason
// code. None of them may guess. A value we could not read stays absent, and the
// row goes on reporting "not reported" rather than quietly acquiring a number.

const tg = require('./telegram');

// '@name' / 't.me/name' / 'https://t.me/name' -> '@name'; anything else -> null.
function normalizeTelegramChannel(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(?:t\.me\/|telegram\.me\/|@)?([A-Za-z0-9_]{4,32})\/?$/);
  return m ? `@${m[1]}` : null;
}

/**
 * Subscriber count for a competitor's PUBLIC Telegram channel, read with the
 * business owner's own bot token.
 *
 * Telegram exposes getChatMemberCount for public channels addressed by
 * @username. Whether a bot that is not a member of a given channel may read it
 * is decided by Telegram per chat, so a refusal here is expected and normal
 * rather than a bug: it maps to 'not_public' and the field stays unknown.
 *
 * Crucially, a failure never yields 0 — "we could not read this" and "this
 * channel has no subscribers" are different claims.
 */
async function telegramAdapter(competitor, ctx) {
  const channel = normalizeTelegramChannel(competitor.telegramChannel);
  if (!channel) return { unavailable: true, reason: 'no_handle' };

  const conn = ctx.db.telegram.findByProfile(ctx.profile.id);
  if (!conn || !conn.botToken) return { unavailable: true, reason: 'no_telegram_bot' };

  try {
    const count = await tg.getChatMemberCount(conn.botToken, channel);
    if (!Number.isFinite(count)) return { unavailable: true, reason: 'not_public' };
    return { fields: { followersCount: count }, sources: { followers: 'telegram' } };
  } catch (err) {
    // 400 "chat not found" / 403 "bot is not a member" both mean we cannot see
    // it, not that the count is zero.
    return { unavailable: true, reason: 'not_public', detail: err.description || err.message };
  }
}

/**
 * Instagram — the one that would matter most here, and the one that is NOT
 * wired. This adapter is a deliberate, documented stub.
 *
 * The Graph API's `business_discovery` field does exactly what this feature
 * wants: query another PUBLIC Business/Creator account by username and read
 * followers_count, media_count, and recent media timestamps — from which a real
 * posts-per-week is computable. It is first-party and involves no scraping.
 *
 * But business_discovery lives on graph.facebook.com and requires a Facebook
 * Page-linked Instagram Business account with a Page access token. Markivo
 * authenticates through Instagram Login (see the header of instagram.js), so
 * every call goes to graph.instagram.com, where that field does not exist.
 * Enabling it therefore needs a second OAuth path — Facebook Login for
 * Business, a linked Page, and App Review for instagram_basic /
 * pages_read_engagement — which is its own piece of work, not a change here.
 *
 * The adapter keeps its real signature so that work is a one-file change, and
 * so the UI can explain the situation instead of silently offering nothing.
 */
async function instagramAdapter(competitor) {
  if (!competitor.instagramHandle) return { unavailable: true, reason: 'no_handle' };
  return { unavailable: true, reason: 'auth_upgrade_required' };
}

const ADAPTERS = { telegram: telegramAdapter, instagram: instagramAdapter };

/**
 * Run every adapter for one competitor. Returns the merged measured fields, the
 * provenance to record alongside them, and a per-source report so the UI can
 * say precisely why anything still missing is missing.
 */
async function enrich(competitor, ctx) {
  const fields = {};
  const sources = {};
  const report = {};

  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    let out;
    try {
      out = await adapter(competitor, ctx);
    } catch (err) {
      out = { unavailable: true, reason: 'failed', detail: err.message };
    }
    if (!out || out.unavailable) {
      report[name] = { ok: false, reason: (out && out.reason) || 'failed' };
      continue;
    }
    Object.assign(fields, out.fields || {});
    Object.assign(sources, out.sources || {});
    report[name] = { ok: true, fields: Object.keys(out.fields || {}) };
  }
  return { fields, sources, report };
}

module.exports = { enrich, normalizeTelegramChannel, ADAPTERS };
