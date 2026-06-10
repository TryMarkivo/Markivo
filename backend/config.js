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
};

// Convenience helpers used by the auth layer.
config.newRefreshToken = () => crypto.randomBytes(32).toString('hex');
config.hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = config;
