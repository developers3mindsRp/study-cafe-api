const crypto = require('crypto');
const config = require('../config');

const TTL_SECONDS = 15 * 60; // 15 minutes
const SECRET = config.internalApiKey || 'dev-internal';

// Tracks consumed tokens in memory. Entry is removed once its natural expiry passes.
const usedTokens = new Set();

function createPreviewToken(articleId) {
  const expires = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const payload = `${articleId}:${expires}`;
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function resolvePreviewToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const lastColon = decoded.lastIndexOf(':');
    const secondLastColon = decoded.lastIndexOf(':', lastColon - 1);
    if (lastColon === -1 || secondLastColon === -1) return null;

    const articleIdStr = decoded.slice(0, secondLastColon);
    const expiresStr = decoded.slice(secondLastColon + 1, lastColon);
    const sig = decoded.slice(lastColon + 1);

    const payload = `${articleIdStr}:${expiresStr}`;
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    const expires = Number(expiresStr);
    if (Math.floor(Date.now() / 1000) > expires) return null;

    // Single-use check
    if (usedTokens.has(token)) return null;

    // Mark as used; auto-evict from memory when the token would have expired anyway
    usedTokens.add(token);
    const msUntilExpiry = expires * 1000 - Date.now();
    setTimeout(() => usedTokens.delete(token), msUntilExpiry).unref();

    const articleId = Number(articleIdStr);
    return Number.isFinite(articleId) && articleId > 0 ? articleId : null;
  } catch {
    return null;
  }
}

module.exports = { createPreviewToken, resolvePreviewToken };
