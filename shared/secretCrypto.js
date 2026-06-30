'use strict';

const crypto = require('crypto');
const { readOptional } = require('./env');

const PREFIX = 'sc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function deriveKeyMaterialCandidates() {
  const raws = [];
  const paymentKey = readOptional('PAYMENT_SECRETS_ENCRYPTION_KEY');
  const jwtSecret = readOptional('JWT_SECRET');
  if (paymentKey) raws.push(paymentKey);
  if (jwtSecret && jwtSecret !== paymentKey) raws.push(jwtSecret);
  if (raws.length === 0) {
    throw new Error(
      'PAYMENT_SECRETS_ENCRYPTION_KEY or JWT_SECRET is required to encrypt payment gateway credentials'
    );
  }
  return raws.map((raw) => crypto.createHash('sha256').update(raw, 'utf8').digest());
}

function deriveKey() {
  return deriveKeyMaterialCandidates()[0];
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function decryptWithKey(text, key) {
  const payload = text.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Invalid encrypted payload');
  }

  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Encrypt a payment credential for at-rest storage. Idempotent when already encrypted.
 */
function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;
  const text = String(plaintext);
  if (isEncrypted(text)) return text;

  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * Decrypt a stored credential. Legacy plaintext values pass through unchanged.
 * Tries PAYMENT_SECRETS_ENCRYPTION_KEY first, then JWT_SECRET.
 * @param {{ soft?: boolean }} [options] - soft: true returns null instead of throwing
 */
function decryptSecret(stored, options = {}) {
  if (stored == null || stored === '') return stored ?? '';
  const text = String(stored);
  if (!isEncrypted(text)) return text;

  const keys = deriveKeyMaterialCandidates();
  for (const key of keys) {
    try {
      return decryptWithKey(text, key);
    } catch {
      // try next key material
    }
  }

  if (options.soft) return null;
  throw new Error('Failed to decrypt payment credential');
}

module.exports = {
  encryptSecret,
  decryptSecret,
  isEncrypted,
};
