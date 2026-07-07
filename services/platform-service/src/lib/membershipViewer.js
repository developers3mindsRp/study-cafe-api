const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');
const { UserMembership, PremiumPlan, sequelize } = require('../models');

/** Map legacy / display membership_type values to canonical plan slugs. */
function normalizeMembershipSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('ultimate')) return 'ultimate';
  if (s === 'advanced') return 'premium';
  if (s.includes('premium')) return 'premium';
  if (s === 'basic') return 'basic';
  return s;
}

function fallbackTierRankForSlug(slug) {
  if (slug === 'ultimate') return 3;
  if (slug === 'premium') return 2;
  if (slug === 'basic') return 1;
  return 0;
}

async function membershipLookupUserIds(userId) {
  const ids = new Set();
  const primary = Number(userId);
  if (!Number.isFinite(primary) || primary <= 0) return [];
  ids.add(primary);
  try {
    const rows = await sequelize.query(
      'SELECT wp_user_id FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
      { replacements: [primary], type: QueryTypes.SELECT },
    );
    const wp = Number(rows[0]?.wp_user_id);
    if (Number.isFinite(wp) && wp > 0) ids.add(wp);
  } catch {
    /* non-blocking — primary id still used */
  }
  return [...ids];
}

async function resolveActiveMembershipForUser(userId, now = new Date()) {
  const lookupIds = await membershipLookupUserIds(userId);
  if (!lookupIds.length) return null;

  const row = await UserMembership.findOne({
    where: {
      user_id: { [Op.in]: lookupIds },
      starts_at: { [Op.lte]: now },
      expires_at: { [Op.gte]: now },
    },
    order: [['expires_at', 'DESC']],
    attributes: ['id', 'membership_type', 'user_id'],
  });
  if (!row) return null;

  const rawSlug = row.get('membership_type') || null;
  const membershipSlug = normalizeMembershipSlug(rawSlug) || rawSlug;
  let membershipTierRank = 0;

  if (membershipSlug) {
    const plan = await PremiumPlan.findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('slug')),
        String(membershipSlug).toLowerCase(),
      ),
      attributes: ['tier_rank', 'slug'],
    });
    membershipTierRank = plan
      ? Number(plan.get('tier_rank') ?? 0)
      : fallbackTierRankForSlug(membershipSlug);
  }

  return {
    membershipSlug,
    membershipTierRank,
    membershipUserId: Number(row.get('user_id')),
  };
}

module.exports = {
  normalizeMembershipSlug,
  fallbackTierRankForSlug,
  membershipLookupUserIds,
  resolveActiveMembershipForUser,
};
