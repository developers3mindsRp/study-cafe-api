'use strict';

/**
 * Pure JavaScript implementation of WordPress's phpass password verification.
 * WordPress uses the Portable PHP password hashing framework (phpass).
 * Hashes start with $P$ (portable) or $H$ (same algorithm, different prefix).
 *
 * Direct port of the PHP reference implementation:
 *   https://www.openwall.com/phpass/
 */

const crypto = require('crypto');

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Encode `count` bytes of a Buffer into phpass's custom base64 encoding.
 * Produces ceil(count * 4/3) characters — for 16 bytes = 22 chars.
 */
function encode64(input, count) {
  let output = '';
  let i = 0;
  do {
    let value = input[i++];
    output += ITOA64[value & 0x3f];
    if (i < count) value |= input[i] << 8;
    output += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    output += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    output += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return output;
}

/**
 * Core phpass hash computation.
 * setting must be a full stored hash (or at least 12 chars: $P$<countChar><salt8>)
 */
function cryptPrivate(password, setting) {
  const id = setting.substr(0, 3);
  if (id !== '$P$' && id !== '$H$') return null;

  const countLog2 = ITOA64.indexOf(setting[3]);
  if (countLog2 < 7 || countLog2 > 30) return null;

  let count = 1 << countLog2;
  const salt = setting.substr(4, 8);
  if (salt.length !== 8) return null;

  // Initial hash: md5(salt + password)
  let hash = crypto.createHash('md5').update(salt + password, 'binary').digest();

  // Iterate
  do {
    hash = crypto.createHash('md5')
      .update(Buffer.concat([hash, Buffer.from(password, 'binary')]))
      .digest();
  } while (--count);

  // Result = 12-char prefix + 22-char encoded hash
  return setting.substr(0, 12) + encode64(hash, 16);
}

/**
 * Check a plain-text password against a stored hash.
 *
 * Supports:
 *   - phpass  ($P$ / $H$)        — WordPress migrated users (most common)
 *   - plain MD5 (32 hex chars)   — very old WordPress accounts
 *   - bcrypt  ($2a$ / $2b$)      — new app registrations (caller uses bcryptjs)
 *
 * Returns:
 *   true   — password matches (phpass or MD5)
 *   false  — password does not match
 *   null   — hash is bcrypt; caller should use bcryptjs.compare()
 */
function checkPassword(password, storedHash) {
  if (!storedHash || !password) return false;

  // bcrypt — signal the caller to use bcryptjs
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    return null;
  }

  // phpass ($P$ or $H$) — standard WordPress
  if (storedHash.startsWith('$P$') || storedHash.startsWith('$H$')) {
    const computed = cryptPrivate(password, storedHash);
    return computed !== null && computed === storedHash;
  }

  // Plain MD5 (32 lowercase hex chars) — very old WordPress accounts
  if (/^[a-f0-9]{32}$/i.test(storedHash)) {
    const md5 = crypto.createHash('md5').update(password).digest('hex');
    return md5 === storedHash;
  }

  return false;
}

module.exports = { checkPassword };
