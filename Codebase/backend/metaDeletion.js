// ==========================================================================
// Meta data-deletion callback support.
//
// Meta POSTs `signed_request` (form-encoded) to the app's Data Deletion Request
// URL when a user removes the app from their Facebook/Instagram account. The
// payload is `<base64url signature>.<base64url json>`, where the signature is
// HMAC-SHA256 of the *encoded payload string* keyed by the app secret.
//
// The endpoint must answer 200 with { url, confirmation_code } so Meta can show
// the user where to track the erasure. Docs:
// https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
// ==========================================================================

const crypto = require('crypto');

class SignedRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SignedRequestError';
  }
}

const b64urlToBuffer = (s) =>
  Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/**
 * Verify and decode a Meta `signed_request`.
 *
 * @param {string} signedRequest  The raw `signed_request` form field.
 * @param {string} appSecret      The Meta app secret the signature is keyed by.
 * @returns {object}              The decoded payload (contains `user_id`).
 * @throws  {SignedRequestError}  On any malformed or unverifiable input.
 */
function parseSignedRequest(signedRequest, appSecret) {
  if (!appSecret) throw new SignedRequestError('app secret is not configured');
  if (!signedRequest || typeof signedRequest !== 'string') {
    throw new SignedRequestError('signed_request is missing');
  }

  const parts = signedRequest.split('.');
  if (parts.length !== 2) throw new SignedRequestError('signed_request is malformed');
  const [encodedSig, encodedPayload] = parts;

  let payload;
  try {
    payload = JSON.parse(b64urlToBuffer(encodedPayload).toString('utf8'));
  } catch {
    throw new SignedRequestError('signed_request payload is not valid JSON');
  }

  // Meta signs with HMAC-SHA256; reject anything else rather than trusting the
  // payload's own claim about how it was signed.
  if (payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') {
    throw new SignedRequestError(`unsupported algorithm ${payload.algorithm}`);
  }

  // The signature covers the ENCODED payload string, not the decoded JSON.
  const expected = crypto.createHmac('sha256', appSecret).update(encodedPayload).digest();
  const actual = b64urlToBuffer(encodedSig);
  // timingSafeEqual throws on a length mismatch, so guard it first.
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    throw new SignedRequestError('signed_request signature does not verify');
  }

  return payload;
}

// A short, unambiguous code the user can quote back to check erasure progress.
// Hex avoids the 0/O and 1/l confusions a user would hit reading it aloud.
const newConfirmationCode = () => crypto.randomBytes(8).toString('hex');

module.exports = { parseSignedRequest, newConfirmationCode, SignedRequestError };
