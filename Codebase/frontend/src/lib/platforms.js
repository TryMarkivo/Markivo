// Shared platform presentation + naming, used by the Connections screen and the
// AI Content Engine's platform tabs.
//
// The SERVER is the source of truth for which platforms exist (via
// /api/connect/status); this module only supplies the icon/brand colour for the
// keys it returns, plus the name the content routes expect for that platform.

// Connector key -> visuals + the platform name /api/content/* speaks.
export const PLATFORM_META = {
  telegram: { icon: 'fa-brands fa-telegram', color: 'var(--tg-blue, #229ED9)', generationKey: 'telegram' },
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // meta_instagram: { icon: 'fa-brands fa-instagram', color: '#E1306C', generationKey: 'instagram' },
  // meta_facebook: { icon: 'fa-brands fa-facebook', color: '#1877F2', generationKey: 'facebook' },
  tiktok: { icon: 'fa-brands fa-tiktok', color: 'var(--text-primary, #111)', generationKey: 'tiktok' },
  google_business: { icon: 'fa-brands fa-google', color: '#4285F4', generationKey: 'googleBusiness' },
  youtube: { icon: 'fa-brands fa-youtube', color: '#FF0000', generationKey: 'youtube' },
};

export const FALLBACK_PLATFORM_META = {
  icon: 'fa-solid fa-share-nodes',
  color: 'var(--accent-primary)',
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // generationKey: 'instagram',
  generationKey: 'tiktok',
};

export const metaFor = (key) => PLATFORM_META[key] || { ...FALLBACK_PLATFORM_META, generationKey: key };

// DISABLED: SEO/Meta temporarily off — see 2026-08-13
// 'meta_instagram' was the ONLY catalogue key that differed from CreatePost's
// channel key. With the Meta adapters out of the registry, every remaining key
// is already the string CreatePost uses, so this is now the identity function.
// The export stays — PublishModal and ContentEngine both import it.
// export const composerKeyFor = (catalogueKey) => (catalogueKey === 'meta_instagram' ? 'instagram' : catalogueKey);
export const composerKeyFor = (catalogueKey) => catalogueKey;

// Shown when /api/connect/status cannot be reached, so the engine still opens
// with usable tabs instead of an empty shell. Mirrors the registry's order.
export const FALLBACK_CATALOGUE = [
  // DISABLED: SEO/Meta temporarily off — see 2026-08-13
  // { key: 'meta_instagram', label: 'Instagram', group: 'meta', live: false, authType: 'oauth', requirements: [], howToConnect: [] },
  { key: 'telegram', label: 'Telegram', group: 'telegram', live: false, authType: 'token', requirements: [], howToConnect: [] },
  { key: 'tiktok', label: 'TikTok', group: 'tiktok', live: false, authType: 'oauth', requirements: [], howToConnect: [] },
];
