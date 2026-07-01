const crypto = require('crypto');
const config = require('./config');

// AES-256-GCM encryption for credentials at rest (e.g. Telegram bot tokens).
// Key is derived from JWT_SECRET so no extra env var is needed; rotating
// JWT_SECRET invalidates stored credentials (users reconnect their bots).
const KEY = crypto.createHash('sha256').update(`${config.jwtSecret}::markivo-credentials`).digest();

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

function decrypt(stored) {
  const [ivHex, tagHex, ctHex] = String(stored).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
