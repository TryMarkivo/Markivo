/**
 * Deterministic SVG logo engine — zero dependencies, zero network.
 *
 * generateLogoVariants({ businessName, category, tone }) returns EXACTLY 4
 * brand-logo variants: [{ svg, palette: { bg, fg, accent }, style }].
 * Every svg is a complete, self-contained document built ONLY from
 * rect/circle/polygon/path/text/g elements, so it is safe to inline anywhere.
 */

// Tone → palette map for the six known brand tones (unknown → brand blue/purple).
const TONE_PALETTES = {
  'Cozy & Warm': { bg: '#2B2118', fg: '#FFF3E0', accent: '#D4A373' }, // gold/cream
  'Modern & Minimalist': { bg: '#1E293B', fg: '#FFFFFF', accent: '#94A3B8' }, // slate/white
  'Energetic & Fast-paced': { bg: '#7C2D12', fg: '#FFF7ED', accent: '#F97316' }, // orange/red
  'Professional & Trustworthy': { bg: '#0C2D57', fg: '#EAF2FF', accent: '#3B82F6' }, // navy/blue
  'Playful & Fun': { bg: '#4A044E', fg: '#FDF4FF', accent: '#EC4899' }, // pink/purple
  'Luxury & Premium': { bg: '#0B0B0B', fg: '#F5EFD9', accent: '#D4AF37' }, // black/gold
};
const DEFAULT_PALETTE = { bg: '#1E1B4B', fg: '#EEF2FF', accent: '#8B5CF6' }; // brand blue/purple

const FONT = 'Arial, Helvetica, sans-serif';

// Minimal XML escaping for text nodes / attribute values we interpolate.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// 1-2 letter monogram from the business name (Unicode-aware).
function initialsOf(businessName) {
  const words = String(businessName || 'M').trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return 'M';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Category → glyph key. Loose keyword matching; building is the default.
function glyphKey(category) {
  const c = String(category || '').toLowerCase();
  if (/(cafe|café|coffee|tea)/.test(c)) return 'cafe';
  if (/(beauty|salon|barber|hair|nail|spa)/.test(c)) return 'beauty';
  if (/(food|restaurant|kitchen|bakery|pizza|grill)/.test(c)) return 'food';
  if (/(tech|software|digital|computer|phone|electronic)/.test(c)) return 'tech';
  if (/(retail|shop|store|boutique|market|fashion)/.test(c)) return 'retail';
  return 'building';
}

// Simple stroke glyphs drawn in a 48x48 box, colored at render time.
const GLYPHS = {
  cafe: (c) =>
    `<path d="M8 16 h24 v10 a10 10 0 0 1 -10 10 h-4 a10 10 0 0 1 -10 -10 z" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M32 19 h4 a5 5 0 0 1 0 10 h-4" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M15 5 q3 4 0 8 M24 5 q3 4 0 8" fill="none" stroke="${c}" stroke-width="2.5"/>`,
  beauty: (c) =>
    `<circle cx="12" cy="36" r="5" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<circle cx="30" cy="36" r="5" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M15 32 L36 6 M27 32 L6 6" fill="none" stroke="${c}" stroke-width="3"/>`,
  food: (c) =>
    `<path d="M16 4 v12 M22 4 v12 M28 4 v12" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M16 16 a6 6 0 0 0 12 0 M22 22 v22" fill="none" stroke="${c}" stroke-width="3"/>`,
  tech: (c) =>
    `<rect x="10" y="8" width="28" height="18" rx="2" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M6 32 h36 l-4 6 H10 z" fill="${c}"/>`,
  retail: (c) =>
    `<path d="M10 16 h28 l-3 26 H13 z" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M17 16 v-4 a7 7 0 0 1 14 0 v4" fill="none" stroke="${c}" stroke-width="3"/>`,
  building: (c) =>
    `<rect x="12" y="6" width="24" height="36" fill="none" stroke="${c}" stroke-width="3"/>` +
    `<path d="M18 13 h4 M26 13 h4 M18 21 h4 M26 21 h4 M18 29 h4 M26 29 h4 M21 36 h6 v6 h-6 z" fill="none" stroke="${c}" stroke-width="2.5"/>`,
};

const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">${inner}</svg>`;

function generateLogoVariants({ businessName, category, tone } = {}) {
  const palette = TONE_PALETTES[tone] || DEFAULT_PALETTE;
  const { bg, fg, accent } = palette;
  const initials = esc(initialsOf(businessName));
  const name = esc(String(businessName || 'Markivo').trim().slice(0, 18));
  const subline = esc(String(category || '').toUpperCase().slice(0, 22));
  const glyph = GLYPHS[glyphKey(category)](accent);

  // 1) Circle monogram — double ring with the initials at the centre.
  const circleMonogram = wrap(
    `<rect width="240" height="240" fill="${bg}"/>` +
    `<circle cx="120" cy="120" r="80" fill="none" stroke="${accent}" stroke-width="6"/>` +
    `<circle cx="120" cy="120" r="66" fill="none" stroke="${accent}" stroke-width="1.5"/>` +
    `<text x="120" y="122" text-anchor="middle" dominant-baseline="middle" font-family="${FONT}" font-size="72" font-weight="bold" fill="${fg}">${initials}</text>`
  );

  // 2) Rounded-square monogram with the category glyph above the letters.
  const squareGlyph = wrap(
    `<rect width="240" height="240" fill="${bg}"/>` +
    `<rect x="36" y="36" width="168" height="168" rx="34" fill="none" stroke="${accent}" stroke-width="5"/>` +
    `<g transform="translate(96 56)">${glyph}</g>` +
    `<text x="120" y="174" text-anchor="middle" font-family="${FONT}" font-size="54" font-weight="bold" fill="${fg}">${initials}</text>`
  );

  // 3) Hexagon badge — filled hex with an inset cut-out and the monogram.
  const hexagonBadge = wrap(
    `<rect width="240" height="240" fill="${bg}"/>` +
    `<polygon points="120,30 198,75 198,165 120,210 42,165 42,75" fill="${accent}"/>` +
    `<polygon points="120,44 186,82 186,158 120,196 54,158 54,82" fill="${bg}"/>` +
    `<text x="120" y="130" text-anchor="middle" font-family="${FONT}" font-size="64" font-weight="bold" fill="${fg}">${initials}</text>`
  );

  // 4) Wordmark bar — the full name over an accent rule, category beneath.
  const nameSize = Math.max(18, Math.min(44, Math.floor(290 / Math.max(name.length, 1))));
  const wordmarkBar = wrap(
    `<rect width="240" height="240" fill="${bg}"/>` +
    `<text x="120" y="118" text-anchor="middle" font-family="${FONT}" font-size="${nameSize}" font-weight="bold" fill="${fg}">${name}</text>` +
    `<rect x="70" y="138" width="100" height="6" fill="${accent}"/>` +
    (subline
      ? `<text x="120" y="168" text-anchor="middle" font-family="${FONT}" font-size="15" fill="${accent}">${subline}</text>`
      : '')
  );

  return [
    { svg: circleMonogram, palette: { ...palette }, style: 'circle-monogram' },
    { svg: squareGlyph, palette: { ...palette }, style: 'square-glyph-monogram' },
    { svg: hexagonBadge, palette: { ...palette }, style: 'hexagon-badge' },
    { svg: wordmarkBar, palette: { ...palette }, style: 'wordmark-bar' },
  ];
}

module.exports = { generateLogoVariants, TONE_PALETTES, DEFAULT_PALETTE };
