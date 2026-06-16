const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const config = require('../config');
const { UserMembership, PremiumPlan } = require('../models');
const { logger } = require('../../../../shared');

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
    const now = new Date();
    const m = await UserMembership.findOne({
      where: {
        user_id: userId,
        starts_at: { [Op.lte]: now },
        expires_at: { [Op.gte]: now },
      },
      order: [['expires_at', 'DESC']],
      attributes: ['id', 'membership_type'],
    });
    let membershipSlug = null;
    let membershipTierRank = 0;
    if (m) {
      membershipSlug = m.get('membership_type') || null;
      if (membershipSlug) {
        const plan = await PremiumPlan.findOne({
          where: { slug: membershipSlug },
          attributes: ['tier_rank'],
        });
        membershipTierRank = plan ? Number(plan.get('tier_rank') ?? 0) : 0;
      }
    }
    req.viewer = {
      userId,
      email: decoded.email,
      role: decoded.role || 'user',
      hasActiveMembership: !!m,
      membershipSlug,
      membershipTierRank,
    };
  } catch (err) {
    req.viewer = null;
    // Surface common misconfigurations (mismatched JWT_SECRET, expired tokens, etc.)
    // so premium-article gating doesn't silently treat real members as guests.
    logger.warn('[optionalWebUser] token verify failed', {
      name: err?.name,
      message: err?.message,
    });
  }
  return next();
}

module.exports = { optionalWebUser };
