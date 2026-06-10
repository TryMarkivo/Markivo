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

module.exports = { isNonEmptyString, isEmail, firstError, validateRegister, validateLogin, validateScan };
