require('dotenv').config();
const crypto = require('crypto');
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';

// --- JWT SECRET ---
// Production: a real secret is mandatory. Development: fall back to a stable
// dev secret so local sessions survive restarts, but warn loudly.
let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProd) {
    throw new Error(
      'FATAL: JWT_SECRET environment variable is required in production. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  }
  jwtSecret = 'markivo_dev_only_insecure_secret_do_not_use_in_prod';
  console.warn(
    '⚠️  JWT_SECRET is not set — using an insecure development default. ' +
    'Set JWT_SECRET in backend/.env before deploying.'
  );
}

// A generation limit override, where 0 is a legitimate value ("this tier does
// not get video at all") and must not be mistaken for "unset".
const limitOr = (raw, fallback) => {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// CORS origins: comma-separated list, or "*" to allow all (dev default).
const corsOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const config = {
  isProd,
  port: parseInt(process.env.PORT, 10) || 5000,
  // Behind a reverse proxy (nginx container, Railway/Render edge) Express must
  // trust X-Forwarded-* or the per-IP rate limiters key on the proxy's IP.
  trustProxy: process.env.TRUST_PROXY === 'true',
  jwtSecret,
  // Short-lived access token, long-lived refresh token.
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '1h',
  refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30,
  corsOrigins,
  dbPath: process.env.DB_PATH || path.join(__dirname, 'database', 'markivo.db'),
  // Per-IP auth rate limit (requests per window).
  authRateLimit: parseInt(process.env.AUTH_RATE_LIMIT, 10) || 30,
  authRateWindowMs: (parseInt(process.env.AUTH_RATE_WINDOW_MIN, 10) || 15) * 60 * 1000,

  // --- AI (Anthropic) ---
  // When ANTHROPIC_API_KEY is unset, the AI layer transparently falls back to
  // smart templates, so the app keeps working without a key.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  // Cheap, fast model for high-volume content; capable model for the agent.
  aiContentModel: process.env.AI_CONTENT_MODEL || 'claude-haiku-4-5',
  aiAgentModel: process.env.AI_AGENT_MODEL || 'claude-opus-4-8',
  // Capable model for the multi-step marketing pipeline (strategy + critique +
  // brand-brief synthesis). Falls back to the content model if unset.
  aiPipelineModel: process.env.AI_PIPELINE_MODEL || process.env.AI_AGENT_MODEL || 'claude-opus-4-8',

  // --- Gemini (Google) — second model for grounded research/trends ---
  // Keyless mode: the Gemini provider transparently no-ops (callers fall back to
  // Claude or templates), so the app and tests run with zero Gemini config.
  // Flip live by setting GEMINI_API_KEY. Claude = strategy/voice/copy/critique;
  // Gemini = local-market research, trends, seasonal hooks feeding the strategy step.
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',

  // --- AI (Google Gemini) — social copy + message templates ---
  // Gemini is the PREFERRED engine for social post copy and for turning a real
  // message an owner sends ("Stadium No:141, 9 spots left ✅") into a reusable
  // template with editable variables. When GEMINI_API_KEY is unset the copy
  // path falls through to Anthropic and then to the smart templates, and the
  // template path falls back to the deterministic heuristic parser in
  // gemini.js — so a blank key never breaks the app or the tests.
  // Key: https://aistudio.google.com/apikey
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  // `gemini-flash-latest` is an alias that tracks the current Flash model, and
  // it carries its own free-tier quota bucket — the pinned `gemini-2.5-flash`
  // name is far more likely to be exhausted on a free project.
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || 'gemini-flash-latest',
  geminiTimeoutMs: parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 20000,

  // --- Media generation (Gemini image + Veo video, same GEMINI_API_KEY) ---
  // Rendering has no honest keyless fallback — a fabricated image would be a
  // lie — so with no key POST /api/media/:id/render answers 501 "engine
  // pending" while briefs, uploads and edit plans keep working.
  //
  // Image: the lite model is ~$0.034 per 1K image, roughly a tenth of the pro
  // tier, and the difference does not show at social-post size.
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-lite-image',
  // Video: cost scales linearly with seconds, so BOTH of these are money dials.
  // Lite at 720p is $0.05/s — a 6s clip costs ~$0.30, against ~$0.40 for 8s and
  // ~$3.20 for 8s on the full model. 6s is ample for a social clip.
  veoModel: process.env.VEO_MODEL || 'veo-3.1-lite-generate-preview',
  veoDurationSeconds: String(limitOr(process.env.VEO_DURATION_SECONDS, 6)),
  veoResolution: process.env.VEO_RESOLUTION || '720p',
  // Video generation runs minutes, not seconds, so it is a polled long-running
  // operation. This bounds how long a job may stay unfinished before the sweep
  // marks it failed and refunds the owner's unit.
  veoMaxWaitMs: parseInt(process.env.VEO_MAX_WAIT_MS, 10) || 10 * 60 * 1000,
  mediaTimeoutMs: parseInt(process.env.MEDIA_TIMEOUT_MS, 10) || 60000,

  // WEEKLY generation allowance per tier, split into three buckets that reset
  // together at 00:00 UTC each Monday.
  //
  // Three buckets rather than one pool because the costs are not remotely
  // comparable: a caption is a fraction of a cent, an image render is ~$0.03,
  // and an 8-second video is ~$0.40 even on the cheapest Veo tier. A single
  // shared counter would let one account spend a hundred times what another
  // does on the same nominal "generation". Splitting them also makes the plan
  // legible to the owner — "4 videos a week" is a promise; "100 generations"
  // is not.
  //
  //   writing — copy, agent replies, slogans, brand briefs, template analysis,
  //             research, autopilot posts, and EVERY media brief / edit plan.
  //             All text, all cheap, so the allowance is generous.
  //   image   — full-mode image renders only.
  //   video   — full-mode video renders only. Zero on freemium: it is the one
  //             feature with real per-use cost, so it gates the upgrade.
  //
  // Overridable per bucket, e.g. AI_LIMIT_PRO_VIDEO=6.
  // `|| default` would swallow a deliberate 0, and 0 is a meaningful limit here
  // (freemium video ships at zero) — so an explicit numeric override wins even
  // when it is zero.
  aiTierLimits: {
    freemium: {
      writing: limitOr(process.env.AI_LIMIT_FREEMIUM_WRITING, 5),
      image: limitOr(process.env.AI_LIMIT_FREEMIUM_IMAGE, 2),
      video: limitOr(process.env.AI_LIMIT_FREEMIUM_VIDEO, 0),
    },
    pro: {
      writing: limitOr(process.env.AI_LIMIT_PRO_WRITING, 15),
      image: limitOr(process.env.AI_LIMIT_PRO_IMAGE, 10),
      video: limitOr(process.env.AI_LIMIT_PRO_VIDEO, 4),
    },
    ultimate: {
      writing: limitOr(process.env.AI_LIMIT_ULTIMATE_WRITING, 40),
      image: limitOr(process.env.AI_LIMIT_ULTIMATE_IMAGE, 25),
      video: limitOr(process.env.AI_LIMIT_ULTIMATE_VIDEO, 12),
    },
  },

  // The bucket names, in display order. Exported so nothing has to re-declare
  // them — a fourth bucket is added here and everything follows.
  usageBuckets: ['writing', 'image', 'video'],

  // --- Billing (Stripe now; Payme/Click slot in after merchant onboarding) ---
  // When STRIPE_SECRET_KEY is unset, billing runs in SIMULATED mode: tier
  // changes apply instantly with no payment, so the upgrade flow stays
  // testable offline (mirrors the keyless AI/Places fallbacks).
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  // Frontend origin for checkout success/cancel redirects.
  appUrl: process.env.APP_URL || 'http://localhost:5173',
  // Monthly subscription prices in USD — provisional until pricing is final.
  tierPrices: {
    pro: parseInt(process.env.TIER_PRICE_PRO, 10) || 20,
    ultimate: parseInt(process.env.TIER_PRICE_ULTIMATE, 10) || 50,
  },

  // --- Feature flags ---
  // Telegram is fully built (backend/telegram.js + TelegramConnect UI) but
  // de-scoped from the MVP (decision 2026-06-10). Default OFF: routes answer
  // 503 "coming soon" and the dashboard shows a Coming-soon pill. Flip to
  // re-enable end-to-end — no code changes needed.
  telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',

  // --- Autopilot (autonomous marketing agent) ---
  // Per-business opt-in agent that analyzes the profile and auto-generates +
  // publishes ORGANIC promotional posts on a cadence. Default ON = the
  // capability exists (owners still enable it per business). Set
  // AUTONOMOUS_ENABLED=false to disable the feature and its background worker.
  // SAFETY: Autopilot never runs paid ad campaigns — money spend always stays
  // behind the deterministic human approval gate.
  autonomousEnabled: process.env.AUTONOMOUS_ENABLED !== 'false',
  // How often the background worker scans for due Autopilot profiles (minutes).
  autonomousTickMs: (parseInt(process.env.AUTONOMOUS_TICK_MIN, 10) || 10) * 60 * 1000,

  // --- Google Places (Discovery scan) ---
  // When GOOGLE_MAPS_API_KEY is unset, the discovery scan transparently falls
  // back to deterministic mock results, so the app keeps working without it.
  placesApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  placesTimeoutMs: parseInt(process.env.PLACES_TIMEOUT_MS, 10) || 8000,
  // Per-IP scan rate limit — live scans cost real Places API quota.
  scanRateLimit: parseInt(process.env.SCAN_RATE_LIMIT, 10) || 10,
  scanRateWindowMs: (parseInt(process.env.SCAN_RATE_WINDOW_MIN, 10) || 15) * 60 * 1000,

  // --- Instagram (Instagram API with Instagram Login) — "Connect Instagram" ---
  // Uses the Instagram **Business Login** flow (instagram.com auth →
  // api.instagram.com / graph.instagram.com), NOT Facebook Login. Credentials
  // are the INSTAGRAM app ID/secret (found under the app's Instagram product →
  // API setup with Instagram login) — distinct from the Facebook app's. When
  // unset the connect routes answer 503 "coming soon" (instagramEnabled ===
  // false). INSTAGRAM_REDIRECT_URI must match the redirect registered in the
  // Instagram business-login settings byte-for-byte, and is reused unchanged in
  // the token exchange.
  instagramAppId: process.env.INSTAGRAM_APP_ID || '',
  instagramAppSecret: process.env.INSTAGRAM_APP_SECRET || '',
  instagramRedirectUri:
    process.env.INSTAGRAM_REDIRECT_URI ||
    process.env.META_REDIRECT_URI ||
    'http://localhost:5000/api/instagram/oauth/callback',
  instagramScopes: 'instagram_business_basic,instagram_business_content_publish',

  // --- Platform connector framework (connectors/*) ---
  // Meta (Facebook/Instagram), TikTok, and Google (Google Business/YouTube)
  // OAuth adapters. Each platform goes LIVE only when its client credentials
  // are present; otherwise isLive() is false and the adapter runs in sandbox
  // mode (simulated publishes) — so Autopilot and the agent work fully keyless.
  // `redirectBase` is the public origin the /api/connect/* callbacks live under.
  // `enabled` flags are computed below from the credentials.
  connectors: {
    redirectBase:
      process.env.CONNECTORS_REDIRECT_BASE ||
      process.env.PUBLIC_BASE_URL ||
      'http://localhost:5000',
    meta: {
      clientId: process.env.META_CLIENT_ID || '',
      clientSecret: process.env.META_CLIENT_SECRET || '',
      enabled: false,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      enabled: false,
    },
    tiktok: {
      clientKey: process.env.TIKTOK_CLIENT_KEY || '',
      clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
      enabled: false,
    },
  },
};

// A connector is live only when BOTH halves of its OAuth client are configured.
// Until then the adapter stays in sandbox mode (simulated publishing).
config.connectors.meta.enabled = !!(config.connectors.meta.clientId && config.connectors.meta.clientSecret);
config.connectors.google.enabled = !!(config.connectors.google.clientId && config.connectors.google.clientSecret);
config.connectors.tiktok.enabled = !!(config.connectors.tiktok.clientKey && config.connectors.tiktok.clientSecret);

config.geminiEnabled = !!config.geminiApiKey;
// Image and video rendering ride the same Gemini key as the text engines —
// one credential, one bill. There is no separate media key any more.
config.mediaEnabled = config.geminiEnabled;
// "AI is on" means at least one text engine is reachable. aiEnabled stays tied
// to Anthropic because ai.js builds its Anthropic client (and the agent's tool
// loop) off it; geminiEnabled gates the Gemini copy + template paths.
config.aiEnabled = !!config.anthropicApiKey;
config.textEngine = config.geminiEnabled ? 'gemini' : (config.aiEnabled ? 'anthropic' : 'template');
// Instagram connect goes live only when both Instagram app credentials are set.
config.instagramEnabled = !!(config.instagramAppId && config.instagramAppSecret);

// Public base URL for assets Instagram must fetch (image_url for publishing) and
// other outward links. Instagram fetches images server-side, so localhost is not
// reachable — in dev this is the tunnel host (derived from the redirect URI's
// origin); set PUBLIC_BASE_URL explicitly in production.
config.publicBaseUrl = process.env.PUBLIC_BASE_URL || (() => {
  try { return new URL(config.instagramRedirectUri).origin; } catch { return ''; }
})();

// Convenience helpers used by the auth layer.
config.newRefreshToken = () => crypto.randomBytes(32).toString('hex');
config.hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = config;
