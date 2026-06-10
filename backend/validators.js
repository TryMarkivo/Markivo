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

module.exports = { isNonEmptyString, isEmail, firstError, validateRegister, validateLogin };
