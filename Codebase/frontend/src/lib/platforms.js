// Shared platform presentation + naming, used by the Connections screen and the
// AI Content Engine's platform tabs.
//
// The SERVER is the source of truth for which platforms exist (via
// /api/connect/status); this module only supplies the icon/brand colour for the
// keys it returns, plus the name the content routes expect for that platform.

// Connector key -> visuals + the platform name /api/content/* speaks.
export const PLATFORM_META = {
  meta_instagram: { icon: 'fa-brands fa-instagram', color: '#E1306C', generationKey: 'instagram' },
  meta_facebook: { icon: 'fa-brands fa-facebook', color: '#1877F2', generationKey: 'facebook' },
  telegram: { icon: 'fa-brands fa-telegram', color: 'var(--tg-blue, #229ED9)', generationKey: 'telegram' },
  google_business: { icon: 'fa-brands fa-google', color: '#4285F4', generationKey: 'googleBusiness' },
  youtube: { icon: 'fa-brands fa-youtube', color: '#FF0000', generationKey: 'youtube' },
};

export const FALLBACK_PLATFORM_META = {
  icon: 'fa-solid fa-share-nodes',
  color: 'var(--accent-primary)',
  generationKey: 'instagram',
};

export const metaFor = (key) => PLATFORM_META[key] || { ...FALLBACK_PLATFORM_META, generationKey: key };

export const composerKeyFor = (catalogueKey) => (catalogueKey === 'meta_instagram' ? 'instagram' : catalogueKey);

// Shown when /api/connect/status cannot be reached, so the engine still opens
// with usable tabs instead of an empty shell. Mirrors the registry's order.
export const FALLBACK_CATALOGUE = [
  { key: 'meta_instagram', label: 'Instagram', group: 'meta', live: false, authType: 'oauth', requirements: [], howToConnect: [] },
  { key: 'telegram', label: 'Telegram', group: 'telegram', live: false, authType: 'token', requirements: [], howToConnect: [] },
  { key: 'google_business', label: 'Google Business Profile', group: 'google', live: false, authType: 'oauth', requirements: [], howToConnect: [] },
];
