// Per-platform post-text character limits for the composer's live counter.
// Mirrors backend/postLimits.js (kept in sync manually — same duplication the
// codebase already accepts for CAPTION_MAX in PublishModal.jsx/InstagramComposer.jsx).
// Commonly-documented caption limits as of writing; [UNVERIFIED] exact current
// values — platforms change these without notice.
export const PLATFORM_LIMITS = {
  instagram: 2200,
  telegram: 4096,
  meta_facebook: 63206,
  tiktok: 2200,
  google_business: 1500,
  youtube: 5000,
};

export const DEFAULT_LIMIT = 3000;

export const limitFor = (platform) => PLATFORM_LIMITS[platform] || DEFAULT_LIMIT;
