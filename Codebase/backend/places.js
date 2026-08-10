const config = require('./config');

// ===========================================================================
// Google Places API (New) client for the Path A "Discovery" scan.
//
// Mirrors the ai.js pattern: with no GOOGLE_MAPS_API_KEY set, every function
// falls back to the same deterministic mock the scan endpoint always served,
// so the app (and the test suite) runs fully offline. With a key, the scan
// performs exactly TWO upstream calls — one Text Search to find the business,
// one Nearby Search for competitors — and never requests Place Details,
// photos, or review content (cost guardrail: the rating/userRatingCount
// fields already bill these calls at the Enterprise SKU, ~1k free/month).
// ===========================================================================

const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';
const SEARCH_NEARBY_URL = 'https://places.googleapis.com/v1/places:searchNearby';

const SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,' +
  'places.primaryType,places.types,places.businessStatus,places.googleMapsUri,' +
  'places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber';

const NEARBY_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location,' +
  'places.primaryType,places.rating,places.userRatingCount,places.googleMapsUri';

class PlacesApiError extends Error {
  constructor(status, message) {
    super(message || `Places API request failed (${status})`);
    this.name = 'PlacesApiError';
    this.status = status;
  }
}

const isLive = () => !!config.placesApiKey;

// 'coffee_shop' -> 'Coffee Shop'
const humanizeType = (t) =>
  t ? t.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;

// The pre-integration mock, byte-compatible with what the scan endpoint
// always returned (plus competitors, which the mock never had).
function mockScanResult(businessName, location) {
  const cleanName = businessName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'business';
  const searchLoc = location || 'Tashkent';
  // Two deterministic alternatives carrying the FULL mapped field set, so the
  // "is this your business?" UI flow is testable without an API key.
  const alternatives = [
    { suffix: 'Center', rating: 4.5, reviewsCount: 22, verified: true },
    { suffix: 'City', rating: 4.3, reviewsCount: 9, verified: false },
  ].map((alt, i) => ({
    placeId: `mock_${cleanName}_alt_${i + 1}`,
    name: `${businessName} ${alt.suffix}`,
    rating: alt.rating,
    reviewsCount: alt.reviewsCount,
    address: `${searchLoc}, Uzbekistan`,
    verified: alt.verified,
    website: null,
    phone: null,
    mapsUrl: `https://maps.google.com/?q=${encodeURIComponent(`${businessName} ${alt.suffix}`)}`,
    location: null,
    primaryType: null,
    category: null,
  }));
  return {
    googleBusiness: { found: true, name: `${businessName} on Google Maps`, rating: 4.8, reviewsCount: 14, address: `${searchLoc}, Uzbekistan`, verified: true, alternatives },
    instagram: { found: true, handle: `@${cleanName}_uz`, followers: 1050, postsCount: 23, url: `https://instagram.com/${cleanName}_uz` },
    telegram: { found: true, channel: `@${cleanName}`, subscribers: 720, url: `https://t.me/${cleanName}` },
    aiSearchPresence: { chatgptMentioned: true, perplexityMentioned: false, perplexityScore: 72 },
    competitors: [],
  };
}

async function callPlaces(url, fieldMask, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.placesApiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.placesTimeoutMs),
    });
  } catch (err) {
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new PlacesApiError(0, 'Places API timed out');
    }
    throw new PlacesApiError(0, `Places API unreachable: ${err.message}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch { /* ignore */ }
    throw new PlacesApiError(res.status, detail || `Places API responded ${res.status}`);
  }
  return res.json();
}

// Exported for unit tests.
async function searchText({ textQuery }, { fetchImpl = fetch } = {}) {
  return callPlaces(SEARCH_TEXT_URL, SEARCH_FIELD_MASK, { textQuery, pageSize: 5 }, fetchImpl);
}

async function findCompetitors(
  { lat, lng, primaryType, excludePlaceId, radiusMeters = 3000, limit = 3 },
  { fetchImpl = fetch } = {}
) {
  const data = await callPlaces(
    SEARCH_NEARBY_URL,
    NEARBY_FIELD_MASK,
    {
      includedTypes: [primaryType],
      maxResultCount: 6, // fetch extra, drop the business itself, keep top `limit`
      rankPreference: 'POPULARITY',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters } },
    },
    fetchImpl
  );
  return (data.places || [])
    .filter((c) => c.id !== excludePlaceId)
    .slice(0, limit)
    .map((c) => ({
      competitorName: c.displayName?.text || 'Unknown',
      rating: c.rating ?? null,
      followersCount: null, // honest: Places has no social-follower data
      postsPerWeek: null,
      platformsDetected: ['google'],
      placeId: c.id,
      address: c.formattedAddress || null,
    }));
}

// Map one raw searchText place into the full client-facing shape. Used for
// the top match AND its alternatives — the searchText response already
// carries every field (no extra API cost to surface them on alternatives).
function mapPlace(p, fallbackName = null) {
  const primaryType = p.primaryType || p.types?.[0] || null;
  return {
    placeId: p.id,
    name: p.displayName?.text || fallbackName,
    rating: p.rating ?? null,
    reviewsCount: p.userRatingCount ?? 0,
    address: p.formattedAddress || null,
    verified: p.businessStatus === 'OPERATIONAL',
    website: p.websiteUri || null,
    phone: p.nationalPhoneNumber || null,
    mapsUrl: p.googleMapsUri || null,
    location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : null,
    primaryType,
    category: humanizeType(primaryType),
  };
}

// ---------------------------------------------------------------------------
// Social sniffing: businesses almost always link their Instagram/Telegram from
// their own homepage. One plain GET (no Google quota, no scraping of the
// platforms themselves) upgrades the honest-but-empty live answer.
// ---------------------------------------------------------------------------

const SNIFF_MAX_BYTES = 400_000; // ~400KB of homepage text is plenty
const IG_LINK_RE = /instagram\.com\/([A-Za-z0-9_.]{2,30})/g;
const TG_LINK_RE = /(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{4,32})/g;
// First path segments that are content/feature pages, not profile handles.
const IG_NON_PROFILE = new Set(['p', 'reel', 'reels', 'explore']);
const TG_NON_CHANNEL = new Set(['share', 'joinchat']);

const sniffNotFound = () => ({
  instagram: { found: false },
  telegram: { found: false, comingSoon: true },
});

function firstHandle(html, regex, ignoreSet) {
  for (const match of html.matchAll(regex)) {
    const handle = match[1];
    if (!ignoreSet.has(handle.toLowerCase())) return handle;
  }
  return null;
}

/**
 * Fetch a business website's homepage and sniff out Instagram/Telegram
 * profile links. Never throws — any fetch/parse problem degrades to the same
 * { found: false } shapes the live scan used before sniffing existed.
 */
async function sniffSocialLinks(websiteUrl, { fetchImpl = fetch } = {}) {
  let html;
  try {
    const res = await fetchImpl(websiteUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(config.placesTimeoutMs),
    });
    if (!res.ok) throw new Error(`website responded ${res.status}`);
    html = (await res.text()).slice(0, SNIFF_MAX_BYTES);
  } catch (err) {
    // Non-fatal by design: a broken/slow website must never fail the scan.
    console.warn(`Social sniff failed for ${websiteUrl}:`, err.message);
    return sniffNotFound();
  }

  const ig = firstHandle(html, IG_LINK_RE, IG_NON_PROFILE);
  const tg = firstHandle(html, TG_LINK_RE, TG_NON_CHANNEL);

  return {
    instagram: ig
      ? { found: true, handle: `@${ig}`, url: `https://instagram.com/${ig}`, source: 'website' }
      : { found: false },
    telegram: tg
      ? { found: true, channel: `@${tg}`, url: `https://t.me/${tg}`, source: 'website', comingSoon: true }
      : { found: false, comingSoon: true },
  };
}

function mapTopMatch(businessName, places) {
  return {
    found: true,
    ...mapPlace(places[0], businessName),
    alternatives: places.slice(1, 4).map((a) => mapPlace(a)),
  };
}

/**
 * Full discovery scan. Returns the complete response body for
 * POST /api/discovery/scan in both keyless (mock) and live modes:
 *   { live, googleBusiness, instagram, telegram, aiSearchPresence, competitors }
 */
async function scanBusiness({ businessName, location = 'Tashkent' }, { fetchImpl = fetch } = {}) {
  if (!isLive()) {
    return { live: false, ...mockScanResult(businessName, location) };
  }

  const data = await searchText({ textQuery: `${businessName}, ${location}` }, { fetchImpl });
  const places = data.places || [];

  // Instagram/Telegram have no public lookup API — with a real key we answer
  // honestly: not found, unless the business's own website links them (see
  // sniffSocialLinks below). aiSearchPresence remains a static estimate until
  // the AI-visibility milestone lands.
  const base = {
    live: true,
    instagram: { found: false },
    telegram: { found: false, comingSoon: true },
    aiSearchPresence: { chatgptMentioned: true, perplexityMentioned: false, perplexityScore: 72 },
  };

  if (!places.length) {
    return { ...base, googleBusiness: { found: false, name: businessName, alternatives: [] }, competitors: [] };
  }

  const googleBusiness = mapTopMatch(businessName, places);

  // Upgrade the static "not found" answers with whatever the business's own
  // homepage links to. sniffSocialLinks never throws.
  if (googleBusiness.website) {
    const social = await sniffSocialLinks(googleBusiness.website, { fetchImpl });
    base.instagram = social.instagram;
    base.telegram = social.telegram;
  }

  let competitors = [];
  if (googleBusiness.location && googleBusiness.primaryType) {
    try {
      competitors = await findCompetitors(
        {
          lat: googleBusiness.location.lat,
          lng: googleBusiness.location.lng,
          primaryType: googleBusiness.primaryType,
          excludePlaceId: googleBusiness.placeId,
        },
        { fetchImpl }
      );
    } catch (err) {
      // Non-fatal: the scan is still a success without competitor intel.
      console.warn('Competitor lookup failed:', err.message);
    }
  }

  return { ...base, googleBusiness, competitors };
}

module.exports = {
  isLive,
  scanBusiness,
  findCompetitors,
  searchText,
  sniffSocialLinks,
  humanizeType,
  mockScanResult,
  PlacesApiError,
  SEARCH_FIELD_MASK,
  NEARBY_FIELD_MASK,
};
