const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../config');
const { UserMembership } = require('../models');

/**
 * Optional JWT + membership hydration for public blog/article routes.
 * Sets req.viewer = { userId, email, role, hasActiveMembership } or null.
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
    const now = new Date();
    const m = await UserMembership.findOne({
      where: {
        user_id: userId,
        starts_at: { [Op.lte]: now },
        expires_at: { [Op.gte]: now },
      },
      order: [['expires_at', 'DESC']],
      attributes: ['id'],
    });
    req.viewer = {
      userId,
      email: decoded.email,
      role: decoded.role || 'user',
      hasActiveMembership: !!m,
    };
  } catch (err) {
    req.viewer = null;
    if (process.env.NODE_ENV !== 'production') {
      // Surface common misconfigurations (mismatched JWT_SECRET, expired tokens, etc.)
      // so premium-article gating doesn't silently treat real members as guests.
      // eslint-disable-next-line no-console
      console.warn('[optionalWebUser] token verify failed:', err?.name || err?.message || err);
    }
  }
  return next();
}

module.exports = { optionalWebUser };
