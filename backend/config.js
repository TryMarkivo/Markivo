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

// CORS origins: comma-separated list, or "*" to allow all (dev default).
const corsOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const config = {
  isProd,
  port: parseInt(process.env.PORT, 10) || 5000,
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

  // Monthly AI generation allowance per pricing tier (content + slogans +
  // agent queries all count). Numbers are provisional until pricing is final.
  aiTierLimits: {
    freemium: parseInt(process.env.AI_LIMIT_FREEMIUM, 10) || 25,
    pro: parseInt(process.env.AI_LIMIT_PRO, 10) || 100,
    ultimate: parseInt(process.env.AI_LIMIT_ULTIMATE, 10) || 250,
  },

  // --- Feature flags ---
  // Telegram is fully built (backend/telegram.js + TelegramConnect UI) but
  // de-scoped from the MVP (decision 2026-06-10). Default OFF: routes answer
  // 503 "coming soon" and the dashboard shows a Coming-soon pill. Flip to
  // re-enable end-to-end — no code changes needed.
  telegramEnabled: process.env.TELEGRAM_ENABLED === 'true',

  // --- Google Places (Discovery scan) ---
  // When GOOGLE_MAPS_API_KEY is unset, the discovery scan transparently falls
  // back to deterministic mock results, so the app keeps working without it.
  placesApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  placesTimeoutMs: parseInt(process.env.PLACES_TIMEOUT_MS, 10) || 8000,
  // Per-IP scan rate limit — live scans cost real Places API quota.
  scanRateLimit: parseInt(process.env.SCAN_RATE_LIMIT, 10) || 10,
  scanRateWindowMs: (parseInt(process.env.SCAN_RATE_WINDOW_MIN, 10) || 15) * 60 * 1000,
};

config.aiEnabled = !!config.anthropicApiKey;

// Convenience helpers used by the auth layer.
config.newRefreshToken = () => crypto.randomBytes(32).toString('hex');
config.hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = config;
