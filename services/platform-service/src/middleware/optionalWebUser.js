const jwt = require('jsonwebtoken');
const config = require('../config');
const { logger } = require('../../../../shared');
const { resolveActiveMembershipForUser } = require('../lib/membershipViewer');

/**
 * Optional JWT + membership hydration for public blog/article routes.
 * Sets req.viewer = { userId, email, role, hasActiveMembership, membershipSlug, membershipTierRank } or null.
 */
async function optionalWebUser(req, res, next) {
  req.viewer = null;
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
    return next();
  }
  try {
    const decoded = jwt.verify(auth.slice(7), config.jwt.secret);
    const userId = Number(decoded.userId);
    if (!Number.isFinite(userId)) return next();

    const membership = await resolveActiveMembershipForUser(userId);
    req.viewer = {
      userId,
      email: decoded.email,
      role: decoded.role || 'user',
      hasActiveMembership: !!membership,
      membershipSlug: membership?.membershipSlug ?? null,
      membershipTierRank: membership?.membershipTierRank ?? 0,
    };
  } catch (err) {
    req.viewer = null;
    logger.warn('[optionalWebUser] token verify failed', {
      name: err?.name,
      message: err?.message,
    });
  }
  return next();
}

module.exports = { optionalWebUser };
