const { UserCourse, UserMembership, User, sequelize } = require('../models');
const { QueryTypes, Op } = require('sequelize');
const { sqlDeletedAtIsNull } = require('../../../../shared');
const authService = require('./auth.service');
const config = require('../config');

/**
 * Check if the user has access to a course via an active membership.
 * A membership grants access to a course if:
 *   - The course is explicitly listed in plan_courses for the user's plan, OR
 *   - The course belongs to a category listed in plan_course_categories for the user's plan.
 * All tables (user_memberships, premium_plans, plan_courses, plan_course_categories,
 * course_categories) are in the same DB, so we do this with a single SQL query.
 */
async function checkMembershipAccess(userId, courseId) {
  const now = new Date();

  // Step 1: Does the user have any active membership?
  const activeMemberships = await UserMembership.findAll({
    where: { user_id: userId },
    attributes: ['membership_type'],
  });
 
  const activeSlugs = activeMemberships
    .map((m) => m.membership_type)
    .filter(Boolean);

  if (activeSlugs.length === 0) return false;

  // Course must be active (not in trash) for membership-based access on public APIs.
  const [activeCourse] = await sequelize.query(
    `SELECT 1 AS ok FROM courses WHERE id = :courseId AND ${sqlDeletedAtIsNull()} LIMIT 1`,
    {
      replacements: { courseId: Number(courseId) },
      type: QueryTypes.SELECT,
    },
  );
  if (!activeCourse) return false;

  // Step 3: Check if any active plan includes this course (via direct ID or category)
  const [result] = await sequelize.query(
    `SELECT 1 AS has_access
     FROM premium_plans pp
     WHERE pp.slug IN (:slugs)
       AND pp.is_active = 1
       AND EXISTS (
         SELECT 1 FROM user_memberships um
         WHERE um.user_id = :userId
           AND um.membership_type = pp.slug
           AND um.expires_at > NOW()
       )
       AND (
         EXISTS (
           SELECT 1 FROM plan_courses pc
           WHERE pc.plan_id = pp.id AND pc.course_id = :courseId
         )
         OR EXISTS (
           SELECT 1 FROM plan_course_categories pcc
           JOIN course_categories cc ON cc.course_cat_id = pcc.course_cat_id
           WHERE pcc.plan_id = pp.id AND cc.course_id = :courseId
         )
       )
     LIMIT 1`,
    {
      replacements: { slugs: activeSlugs, userId: Number(userId), courseId: Number(courseId) },
      type: QueryTypes.SELECT,
    }
  );

  return !!result;
}

async function checkAccess(token, courseId) {
  const decoded = authService.verifyAccess(token);
  const userId = decoded.userId;

  // Fast path: direct purchase enrollment
  const row = await UserCourse.findOne({
    where: { user_id: userId, course_id: courseId },
  });
  if (row) {
    // expires_at = null means lifetime; otherwise check if still valid
    if (!row.expires_at || new Date(row.expires_at) > new Date()) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'course_expired' };
  }

  // Slower path: membership-based access
  const hasMembershipAccess = await checkMembershipAccess(userId, courseId);
  if (!hasMembershipAccess) return { allowed: false };

  // Lazy-enroll the user in user_courses so progress tracking works going forward.
  // Uses findOrCreate so concurrent requests are safe.
  await UserCourse.findOrCreate({
    where: { user_id: userId, course_id: courseId },
    defaults: { order_id: null },
  });

  return { allowed: true };
}

function isAuthorizedForGrant(req) {
  const key = req.headers['x-internal-api-key'];
  if (config.internalApiKey && key === config.internalApiKey) return true;
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return false;
  try {
    const decoded = authService.verifyAccess(auth.slice(7));
    return decoded.role === 'admin';
  } catch (_) {
    return false;
  }
}

async function grantCourse({ userId, courseId, orderId, expiresAt }) {
  const [row, created] = await UserCourse.findOrCreate({
    where: { user_id: userId, course_id: courseId },
    defaults: { order_id: orderId || null, expires_at: expiresAt ?? null },
  });
  if (!created) {
    await row.update({ order_id: orderId || row.order_id, expires_at: expiresAt ?? row.expires_at });
  }
  return { granted: true };
}

async function getActiveMembership(userId) {
  const row = await UserMembership.findOne({
    where: { user_id: userId, expires_at: { [Op.gt]: new Date() } },
    order: [['expires_at', 'DESC']],
  });
  return row ? row.get({ plain: true }) : null;
}

async function grantMembership({ userId, membershipType, orderId, startsAt, expiresAt, planJson }) {
  // Expire any existing active membership rows before inserting the new tier.
  // This keeps the history intact while ensuring only one active membership exists.
  await UserMembership.update(
    { expires_at: new Date() },
    { where: { user_id: userId, expires_at: { [Op.gt]: new Date() } } }
  );
  await UserMembership.create({
    user_id: userId,
    membership_type: membershipType,
    order_id: orderId || null,
    starts_at: startsAt,
    expires_at: expiresAt,
  });

  // Sync the main User table columns so the profile UI reflects the change immediately.
  // planJson (if provided) stores { price, plan_validity, plan_purchased, plan_expiry, payment_id }
  const planValue = planJson ? JSON.stringify(planJson) : membershipType;
  await User.update(
    {
      membership: 1,
      plan: planValue,
    },
    { where: { id: userId } }
  );

  return { granted: true };
}

async function revokeCourse({ userId, courseId, orderId }) {
  // We remove the user_courses entry to revoke access. 
  // If orderId is provided, we try to match it, but generally, we remove the course access entirely for this user.
  const where = { user_id: userId, course_id: courseId };
  if (orderId) where.order_id = orderId;
  
  await UserCourse.destroy({ where });
  return { revoked: true };
}

async function revokeMembership({ userId, orderId }) {
  // Expire the membership associated with this order
  await UserMembership.update(
    { expires_at: new Date() },
    { where: { user_id: userId, order_id: orderId } }
  );
  
  // After expiring, check if user still has ANY active membership.
  // If not, clear their membership status on the User table.
  const active = await getActiveMembership(userId);
  if (!active) {
    await User.update(
      { membership: 0, plan: null },
      { where: { id: userId } }
    );
  }
  
  return { revoked: true };
}

module.exports = {
  checkAccess,
  isAuthorizedForGrant,
  grantCourse,
  revokeCourse,
  grantMembership,
  revokeMembership,
  getActiveMembership,
};