const axios = require('axios');
const config = require('../config');
const { logger } = require('../../../../shared');

/**
 * Validate the bearer token by asking auth-service. Returns the decoded user
 * payload (`{ userId, id, role, ... }`) or throws.
 */
async function validateBearerToken(token) {
  const { data: body } = await axios.get(`${config.authServiceUrl}/auth/validate`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 5000,
  });
  // sendSuccess wraps as { success, data: {...} }; accept both shapes
  const finalData =
    body && typeof body === 'object' && body.data != null && typeof body.data === 'object'
      ? body.data
      : body;
  return finalData;
}

/**
 * Ask auth-service for the user's memberships and return whether any are
 * currently active (expires_at > now). Uses x-internal-api-key.
 */
async function fetchActiveMembership(userId) {
  if (!config.internalApiKey) {
    logger.error('[memberAuth] INTERNAL_API_KEY is not configured — cannot verify membership');
    return { active: false, expiresAt: null, membershipType: null };
  }
  try {
    const { data: body } = await axios.get(
      `${config.authServiceUrl}/internal/users/${encodeURIComponent(String(userId))}/memberships`,
      {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 5000,
      }
    );
    const rows =
      Array.isArray(body) ? body
        : Array.isArray(body?.data) ? body.data
          : [];
    const now = Date.now();
    let best = null;
    for (const r of rows) {
      const exp = r?.expires_at ? new Date(r.expires_at).getTime() : 0;
      if (exp > now && (!best || exp > new Date(best.expires_at).getTime())) {
        best = r;
      }
    }
    return {
      active: !!best,
      expiresAt: best?.expires_at || null,
      membershipType: best?.membership_type || null,
    };
  } catch (err) {
    logger.error(`[memberAuth] membership lookup failed for user ${userId}: ${err.message}`);
    return { active: false, expiresAt: null, membershipType: null };
  }
}

/**
 * Express middleware that requires:
 *   1. a valid Bearer token (validated against auth-service /auth/validate), AND
 *   2. an active membership row in user_memberships (expires_at > now).
 *
 * On success, attaches `req.user = { userId, id, role, ... }` and
 * `req.membership = { active, expiresAt, membershipType }`.
 */
async function requireActiveMembership(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authorization required' });
  }
  const token = auth.slice(7);

  let user;
  try {
    user = await validateBearerToken(token);
  } catch (err) {
    const status = err.response?.status || 401;
    const message = err.response?.data?.error || 'Invalid or expired token';
    return res.status(status).json({ success: false, error: message });
  }

  const userId = user?.userId ?? user?.id;
  if (!userId) {
    return res.status(401).json({ success: false, error: 'Invalid token payload' });
  }

  const membership = await fetchActiveMembership(userId);
  if (!membership.active) {
    return res
      .status(403)
      .json({ success: false, error: 'Active membership required to download files' });
  }

  req.user = user;
  req.membership = membership;
  next();
}

module.exports = { requireActiveMembership };
