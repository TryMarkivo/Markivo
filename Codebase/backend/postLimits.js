// Per-platform post-text character limits, shared by /api/content/schedule and
// /api/content/post-now. Commonly-documented caption limits as of writing;
// [UNVERIFIED] exact current values the same way connectors/meta.js flags its
// own platform-detail uncertainties — platforms change these without notice.
const PLATFORM_LIMITS = {
  instagram: 2200,
  telegram: 4096,
  meta_facebook: 63206,
  tiktok: 2200,
  google_business: 1500,
  youtube: 5000,
};

const DEFAULT_LIMIT = 3000;

const limitFor = (platform) => PLATFORM_LIMITS[platform] || DEFAULT_LIMIT;

module.exports = { PLATFORM_LIMITS, DEFAULT_LIMIT, limitFor };
