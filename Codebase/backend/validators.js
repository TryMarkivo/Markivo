// Lightweight, dependency-free input validation helpers.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isEmail = (v) => isNonEmptyString(v) && EMAIL_RE.test(v.trim());

/**
 * Run an array of [condition, message] checks. Returns the first failing
 * message, or null if all pass.
 */
function firstError(checks) {
  for (const [ok, message] of checks) {
    if (!ok) return message;
  }
  return null;
}

function validateRegister(body = {}) {
  const { email, password, fullName } = body;
  return firstError([
    [isEmail(email), 'A valid email address is required'],
    [isNonEmptyString(password) && password.length >= 6, 'Password must be at least 6 characters'],
    [isNonEmptyString(fullName), 'Full name is required'],
  ]);
}

function validateLogin(body = {}) {
  const { email, password } = body;
  return firstError([
    [isEmail(email), 'A valid email address is required'],
    [isNonEmptyString(password), 'Password is required'],
  ]);
}

function validateScan(body = {}) {
  const { businessName, location } = body;
  const name = typeof businessName === 'string' ? businessName.trim() : '';
  // Length checks only — names in Uzbek/Russian (Cyrillic) must pass untouched.
  return firstError([
    [name.length >= 2, 'Business name must be at least 2 characters'],
    [name.length <= 100, 'Business name must be 100 characters or fewer'],
    [location == null || (typeof location === 'string' && location.trim().length <= 100), 'Location must be 100 characters or fewer'],
  ]);
}

// Discovery: competitor lookup around a confirmed business location.
function validateCompetitors(body = {}) {
  const { lat, lng, primaryType, excludePlaceId } = body;
  const type = typeof primaryType === 'string' ? primaryType.trim() : '';
  return firstError([
    [typeof lat === 'number' && Number.isFinite(lat), 'A finite numeric lat is required'],
    [typeof lng === 'number' && Number.isFinite(lng), 'A finite numeric lng is required'],
    [type.length >= 2 && type.length <= 60, 'primaryType must be 2-60 characters'],
    [excludePlaceId == null || typeof excludePlaceId === 'string', 'excludePlaceId must be a string'],
  ]);
}

// Settings: partial profile update — every field is optional, but anything
// present must be sane. Length checks only (Cyrillic must pass untouched).
function validateProfileUpdate(body = {}) {
  const { businessName, category, description, location, slogan, brandTone } = body;
  const audience = body.targetAudience !== undefined ? body.targetAudience : body.audience;
  const name = typeof businessName === 'string' ? businessName.trim() : '';
  const shortOk = (v) => v == null || (typeof v === 'string' && v.length <= 120);
  return firstError([
    [businessName === undefined || (name.length >= 2 && name.length <= 100), 'Business name must be 2-100 characters'],
    [shortOk(category), 'Category must be 120 characters or fewer'],
    [shortOk(location), 'Location must be 120 characters or fewer'],
    [shortOk(slogan), 'Slogan must be 120 characters or fewer'],
    [shortOk(audience), 'Target audience must be 120 characters or fewer'],
    [shortOk(brandTone), 'Brand tone must be 120 characters or fewer'],
    [description == null || (typeof description === 'string' && description.length <= 600), 'Description must be 600 characters or fewer'],
  ]);
}

// Settings: partial account update.
function validateMeUpdate(body = {}) {
  const { fullName, preferredLang } = body;
  const name = typeof fullName === 'string' ? fullName.trim() : '';
  return firstError([
    [fullName === undefined || (name.length >= 2 && name.length <= 80), 'Full name must be 2-80 characters'],
    [preferredLang === undefined || ['uz', 'ru', 'en'].includes(preferredLang), 'Preferred language must be one of: uz, ru, en'],
  ]);
}

// Competitor Intelligence: manual "paste a profile link" flow. One regex per
// platform, loose enough to accept the common URL shapes people actually
// paste (with/without protocol, trailing slash, query string).
const PLATFORM_URL_RE = {
  instagram: /^(https?:\/\/)?(www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})\/?/i,
  tiktok: /^(https?:\/\/)?(www\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,30})\/?/i,
  youtube: /^(https?:\/\/)?(www\.)?youtube\.com\/(@[A-Za-z0-9_.-]{2,60}|channel\/[A-Za-z0-9_-]{10,40}|c\/[A-Za-z0-9_.-]{2,60})\/?/i,
  facebook: /^(https?:\/\/)?(www\.)?facebook\.com\/([A-Za-z0-9.]{2,60})\/?/i,
};
const SUPPORTED_PLATFORMS = Object.keys(PLATFORM_URL_RE);

const isValidCompetitorUrl = (platform, url) =>
  typeof platform === 'string' && typeof url === 'string' &&
  !!PLATFORM_URL_RE[platform.toLowerCase()] &&
  PLATFORM_URL_RE[platform.toLowerCase()].test(url.trim());

// Add a competitor with one or more platform links, e.g.
// { name, sources: [{ platform: 'instagram', url: '...' }, ...] }
function validateAddCompetitor(body = {}) {
  const { name, sources } = body;
  const list = Array.isArray(sources) ? sources : [];
  return firstError([
    [name == null || (typeof name === 'string' && name.trim().length <= 120), 'Competitor name must be 120 characters or fewer'],
    [list.length >= 1, 'At least one platform link is required'],
    [list.length <= SUPPORTED_PLATFORMS.length, `A competitor can have at most ${SUPPORTED_PLATFORMS.length} platform links`],
    [list.every((s) => s && typeof s.platform === 'string' && SUPPORTED_PLATFORMS.includes(s.platform.toLowerCase())),
      `Each platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}`],
    [list.every((s) => s && isValidCompetitorUrl(s.platform, s.url)),
      'Each link must be a valid profile URL for its platform (e.g. instagram.com/handle, tiktok.com/@handle, youtube.com/@handle, facebook.com/page)'],
  ]);
}

// Add a single extra platform link to an existing competitor.
function validateCompetitorSource(body = {}) {
  const { platform, url } = body;
  return firstError([
    [typeof platform === 'string' && SUPPORTED_PLATFORMS.includes(platform.toLowerCase()), `Platform must be one of: ${SUPPORTED_PLATFORMS.join(', ')}`],
    [isValidCompetitorUrl(platform, url), 'A valid profile URL for that platform is required'],
  ]);
}

module.exports = {
  isNonEmptyString, isEmail, firstError, validateRegister, validateLogin, validateScan, validateCompetitors,
  validateProfileUpdate, validateMeUpdate, validateAddCompetitor, validateCompetitorSource,
  isValidCompetitorUrl, SUPPORTED_PLATFORMS,
};
