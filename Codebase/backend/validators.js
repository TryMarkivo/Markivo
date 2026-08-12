// Lightweight, dependency-free input validation helpers.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isEmail = (v) => isNonEmptyString(v) && EMAIL_RE.test(v.trim());

/**
 * Parse a numeric field that is allowed to be UNKNOWN. Blank, null, and absent
 * all mean "not reported" and stay null — never 0.
 *
 * Use this instead of `Number.isFinite(+v) ? +v : null`: `+null === 0` and
 * `Number.isFinite(0)` is true, so that idiom silently turns an honest null
 * into a fabricated zero. Google Places returns explicit nulls for follower
 * counts and posting cadence because it cannot measure them, and a competitor
 * shown as "0 posts/week" is a number the owner may act on.
 */
const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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

/**
 * Competitor Intel: a manually added or edited competitor row.
 *
 * Every metric is optional BY DESIGN. Google Places cannot report a
 * competitor's follower count or posting cadence, so a blank field is the
 * normal case and must validate as null — not be rejected, and not be coerced
 * to 0. Range checks only apply once a value is actually present.
 */
function validateCompetitorInput(body = {}) {
  const raw = typeof body.competitorName === 'string' ? body.competitorName
    : (typeof body.name === 'string' ? body.name : '');
  const name = raw.trim();
  const rating = numOrNull(body.rating);
  const followers = numOrNull(body.followersCount);
  const cadence = numOrNull(body.postsPerWeek);
  // Length checks only — Uzbek/Russian names must pass untouched.
  const str = (v, max) => v == null || (typeof v === 'string' && v.length <= max);
  return firstError([
    [name.length >= 2, 'Competitor name must be at least 2 characters'],
    [name.length <= 120, 'Competitor name must be 120 characters or fewer'],
    [rating === null || (rating >= 0 && rating <= 5), 'Rating must be between 0 and 5'],
    [followers === null || (followers >= 0 && followers <= 1e9), 'Follower count must be a positive number'],
    [cadence === null || (cadence >= 0 && cadence <= 200), 'Posts per week must be between 0 and 200'],
    [body.platformsDetected == null || (Array.isArray(body.platformsDetected) && body.platformsDetected.length <= 6), 'At most 6 platforms can be listed'],
    [str(body.address, 200), 'Address must be 200 characters or fewer'],
    [str(body.notes, 500), 'Notes must be 500 characters or fewer'],
    [str(body.instagramHandle, 30), 'Instagram handle must be 30 characters or fewer'],
    [str(body.telegramChannel, 64), 'Telegram channel must be 64 characters or fewer'],
    [str(body.website, 200), 'Website must be 200 characters or fewer'],
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

module.exports = { isNonEmptyString, isEmail, numOrNull, firstError, validateRegister, validateLogin, validateScan, validateCompetitors, validateCompetitorInput, validateProfileUpdate, validateMeUpdate };
