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
  } catch (_) {
    req.viewer = null;
  }
  return next();
}

module.exports = { optionalWebUser };
