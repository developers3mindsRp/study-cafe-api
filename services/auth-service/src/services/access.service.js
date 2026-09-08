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

  // Resolve internal id + wp_user_id so migrated memberships (stored under the
  // legacy WP user id) are matched too.
  const userRow = await User.findByPk(userId, { attributes: ['id', 'wp_user_id'] });
  const lookupIds = [Number(userId)];
  if (userRow?.wp_user_id != null) lookupIds.push(Number(userRow.wp_user_id));

  // Step 1: Does the user have any active membership?
  const activeMemberships = await UserMembership.findAll({
    where: { user_id: { [Op.in]: lookupIds } },
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
         WHERE um.user_id IN (:lookupIds)
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
      replacements: { slugs: activeSlugs, lookupIds, courseId: Number(courseId) },
      type: QueryTypes.SELECT,
    }
  );

  return !!result;
}

async function checkAccess(token, courseId) {
  const decoded = authService.verifyAccess(token);
  const userId = decoded.userId;

  // Fast path: direct purchase enrollment that is still valid (lifetime or unexpired).
  // A row an admin has revoked grants nothing — it is kept only as the record of the
  // deallotment — but it must still fall through to the membership check below, exactly
  // like an expired grant does.
  const row = await UserCourse.findOne({
    where: { user_id: userId, course_id: courseId },
  });
  const revoked = !!row?.revoked_at;
  if (row && !revoked && (!row.expires_at || new Date(row.expires_at) > new Date())) {
    return { allowed: true };
  }

  // Direct purchase is absent OR expired → fall back to membership access.
  // NOTE: an expired purchase must NOT short-circuit here — a learner whose
  // standalone purchase lapsed may still have the course via an active membership
  // (that's why "Continue learning" was redirecting them to the buy page).
  const hasMembershipAccess = await checkMembershipAccess(userId, courseId);
  if (!hasMembershipAccess) {
    // No membership either: report course_expired if they once had a purchase.
    return row ? { allowed: false, reason: 'course_expired' } : { allowed: false };
  }

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
    // Extend-only renewal: never shorten an existing grant, always honour a longer one.
    //  - expires_at = null means lifetime access, so null on either side always wins.
    //  - otherwise keep the later of (existing, new). This lets a repurchase after
    //    expiry renew access (new future date > old past date) while a shorter grant
    //    can never clip a longer/active one.
    const existing = row.expires_at;
    let nextExpiry;
    if (existing == null || expiresAt == null) {
      nextExpiry = null;
    } else {
      nextExpiry = new Date(expiresAt) > new Date(existing) ? expiresAt : existing;
    }
    // Granting always clears a previous admin deallotment: re-allotting or repurchasing
    // a revoked course must restore access, not leave a stamped row that keeps hiding it.
    await row.update({ order_id: orderId || row.order_id, expires_at: nextExpiry, revoked_at: null });
  }
  return { granted: true };
}

async function getActiveMembership(userId) {
  const userRow = await User.findByPk(userId, { attributes: ['id', 'wp_user_id'] });
  const lookupIds = [Number(userId)];
  if (userRow?.wp_user_id != null) lookupIds.push(Number(userRow.wp_user_id));
  const row = await UserMembership.findOne({
    where: { user_id: { [Op.in]: lookupIds }, expires_at: { [Op.gt]: new Date() } },
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

/**
 * Downgrade a user to the Free tier by expiring EVERY currently-active membership
 * (regardless of order), then resetting the User table columns. Unlike
 * revokeMembership (which targets a single order), this is used by the admin panel
 * "Free" option to fully remove a user's paid membership. History rows are kept
 * intact — we only push their expires_at to now.
 */
async function removeMembership({ userId }) {
  // Match memberships stored under BOTH the internal id and the legacy wp_user_id.
  const userRow = await User.findByPk(userId, { attributes: ['id', 'wp_user_id'] });
  const lookupIds = [Number(userId)];
  if (userRow?.wp_user_id != null) lookupIds.push(Number(userRow.wp_user_id));

  await UserMembership.update(
    { expires_at: new Date() },
    { where: { user_id: { [Op.in]: lookupIds }, expires_at: { [Op.gt]: new Date() } } }
  );

  // Reset the User table so the profile/list UI reflects Free immediately.
  await User.update(
    { membership: 0, plan: null },
    { where: { id: userId } }
  );

  return { removed: true };
}

module.exports = {
  checkAccess,
  isAuthorizedForGrant,
  grantCourse,
  revokeCourse,
  grantMembership,
  revokeMembership,
  removeMembership,
  getActiveMembership,
};