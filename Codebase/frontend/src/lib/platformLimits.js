// Per-platform post-text character limits for the composer's live counter.
// Mirrors backend/postLimits.js (kept in sync manually — same duplication the
// codebase already accepts for CAPTION_MAX in PublishModal.jsx/InstagramComposer.jsx).
// Commonly-documented caption limits as of writing; [UNVERIFIED] exact current
// values — platforms change these without notice.
export const PLATFORM_LIMITS = {
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // instagram: 2200,
  // meta_facebook: 63206,
  telegram: 4096,
  tiktok: 2200,
  google_business: 1500,
  youtube: 5000,
};

export const DEFAULT_LIMIT = 3000;

export const limitFor = (platform) => PLATFORM_LIMITS[platform] || DEFAULT_LIMIT;
