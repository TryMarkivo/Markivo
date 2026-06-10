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
  return {
    googleBusiness: { found: true, name: `${businessName} on Google Maps`, rating: 4.8, reviewsCount: 14, address: `${searchLoc}, Uzbekistan`, verified: true },
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

function mapTopMatch(businessName, places) {
  const p = places[0];
  const primaryType = p.primaryType || p.types?.[0] || null;
  return {
    found: true,
    placeId: p.id,
    name: p.displayName?.text || businessName,
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
    alternatives: places.slice(1, 4).map((a) => ({
      placeId: a.id,
      name: a.displayName?.text || null,
      address: a.formattedAddress || null,
      rating: a.rating ?? null,
    })),
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

  // Instagram/Telegram presence detection has no public lookup API — with a
  // real key we answer honestly (Telegram is additionally post-MVP).
  // aiSearchPresence remains a static estimate until the AI-visibility
  // milestone lands.
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
  humanizeType,
  mockScanResult,
  PlacesApiError,
  SEARCH_FIELD_MASK,
  NEARBY_FIELD_MASK,
};
