const accessController = require('../controllers/access.controller');
const accessService = require('../services/access.service');
const {
  sendPaymentEmail,
  sendCourseAccessEmail,
  sendWithdrawalEmail,
  sendMembershipUpgradeEmail,
  sendCourseCompletionCertificateEmail,
} = require('../services/email.service');
const { requireGrantAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');
const { User } = require('../models');
const { asyncHandler, sendSuccess, AppError } = require('../../../../shared');

function register(router) {
  router.get('/access/check', validate(schemas.checkAccess), accessController.check);
  router.post('/access/grant-course', requireGrantAuth, validate(schemas.grantCourse), accessController.grantCourse);
  router.post('/access/revoke-course', requireGrantAuth, validate(schemas.revokeCourse), accessController.revokeCourse);
  router.post('/access/grant-membership', requireGrantAuth, validate(schemas.grantMembership), accessController.grantMembership);
  router.post('/access/revoke-membership', requireGrantAuth, validate(schemas.revokeMembership), accessController.revokeMembership);
  router.post('/access/remove-membership', requireGrantAuth, validate(schemas.removeMembership), accessController.removeMembership);

  router.post('/internal/users/by-emails', requireGrantAuth, asyncHandler(async (req, res) => {
    const emails = Array.isArray(req.body.emails) ? req.body.emails : [];
    const rows = await User.findAll({
      where: { email: emails },
      // `phone` backs buyer_mobile on bulk-allotment orders — without it every order
      // created from a bulk run stored a null mobile while the single-user path (which
      // reads /internal/users/:id/contact) stored the real one.
      attributes: ['id', 'name', 'email', 'phone'],
    });
    sendSuccess(res, rows.map((r) => r.get({ plain: true })));
  }));

  router.get('/internal/users/by-referral-code/:code', requireGrantAuth, asyncHandler(async (req, res) => {
    const user = await User.findOne({
      where: { referral_code: req.params.code },
      attributes: ['id', 'name', 'email', 'referred_at'],
    });
    if (!user) throw new AppError('User not found', 404);
    sendSuccess(res, user.get({ plain: true }));
  }));

  // Called by order-service when a checkout completes. A buyer who just paid (or
  // claimed a free campaign seat) gets their receipt and access emails at this
  // address, so the account is treated as verified — without this, quick-registered
  // checkout buyers pay and then hit the /verify-email wall before they can see
  // their purchase. Idempotent: an already-verified account is left untouched.
  router.post('/internal/users/:id/mark-email-verified', requireGrantAuth, asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id, { attributes: ['id', 'email_verified_at'] });
    if (!user) throw new AppError('User not found', 404);
    if (!user.email_verified_at) {
      await user.update({ email_verified_at: new Date() });
    }
    sendSuccess(res, { verified: true });
  }));

  router.get('/internal/users/:id/contact', requireGrantAuth, asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id, {
      attributes: ['id', 'name', 'email', 'phone'],
    });
    if (!user) throw new AppError('User not found', 404);
    sendSuccess(res, user.get({ plain: true }));
  }));

  router.get('/internal/users/:id/courses', requireGrantAuth, asyncHandler(async (req, res) => {
    const accountService = require('../services/account.service');
    // Admin callers need the deallotted grants too (flagged `isRevoked`): a course the
    // admin removed must be reported as removed, not silently absent like a grant that
    // was never written. Opt in via ?includeRevoked=1 so existing callers are unchanged.
    const includeRevoked = req.query.includeRevoked === '1' || req.query.includeRevoked === 'true';
    const data = await accountService.myCourses(req.params.id, { includeRevoked });
    sendSuccess(res, data);
  }));

  router.get('/internal/users/:id/active-membership', requireGrantAuth, asyncHandler(async (req, res) => {
    const activeMembership = await accessService.getActiveMembership(req.params.id);
    sendSuccess(res, activeMembership);
  }));

  /**
   * Active memberships for many users at once.
   *
   * Backs the admin bulk-allotment duplicate guard: a 1000-row upload cannot make
   * 1000 calls to /internal/users/:id/active-membership. Resolves the same way
   * accessService.getActiveMembership does — matching on BOTH the internal id and
   * wp_user_id, since memberships migrated from WP are keyed on the latter — and
   * returns one row per requested user id (the latest-expiring active one).
   */
  router.post('/internal/users/active-memberships', requireGrantAuth, asyncHandler(async (req, res) => {
    const { UserMembership } = require('../models');
    const { Op } = require('sequelize');

    const ids = (Array.isArray(req.body.userIds) ? req.body.userIds : [])
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    if (ids.length === 0) return sendSuccess(res, []);

    const users = await User.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'wp_user_id'],
      raw: true,
    });

    // wp_user_id -> internal id, so a membership row found under the legacy id is
    // reported against the user the caller actually asked about.
    const ownerByLookupId = new Map();
    for (const u of users) {
      ownerByLookupId.set(Number(u.id), Number(u.id));
      if (u.wp_user_id != null) ownerByLookupId.set(Number(u.wp_user_id), Number(u.id));
    }

    const rows = await UserMembership.findAll({
      where: {
        user_id: { [Op.in]: [...ownerByLookupId.keys()] },
        expires_at: { [Op.gt]: new Date() },
      },
      order: [['expires_at', 'ASC']],
      raw: true,
    });

    // Ascending expiry + overwrite leaves the latest-expiring row per user, matching
    // getActiveMembership's `order by expires_at DESC` + findOne.
    const activeByUserId = new Map();
    for (const row of rows) {
      const ownerId = ownerByLookupId.get(Number(row.user_id));
      if (ownerId != null) activeByUserId.set(ownerId, { ...row, user_id: ownerId });
    }

    sendSuccess(res, [...activeByUserId.values()]);
  }));

  router.get('/internal/users/:id/memberships', requireGrantAuth, asyncHandler(async (req, res) => {
    const { UserMembership } = require('../models');
    const { Op } = require('sequelize');

    // Resolve the user so we can look up by BOTH internal id and wp_user_id.
    // Historical memberships (migrated from WP) may use wp_user_id as the user_id,
    // while newer memberships use the internal users.id.
    const user = await User.findByPk(req.params.id, {
      attributes: ['id', 'wp_user_id'],
    });

    const lookupIds = [req.params.id];
    if (user && user.wp_user_id != null) {
      lookupIds.push(String(user.wp_user_id));
    }

    const rows = await UserMembership.findAll({
      where: { user_id: { [Op.in]: lookupIds } },
      order: [['starts_at', 'DESC']],
      raw: true,
    });
    sendSuccess(res, rows);
  }));

  router.post('/internal/send-payment-email', requireGrantAuth, asyncHandler(async (req, res) => {
    const { to, status, orderId } = req.body;
    if (!to || !status || !orderId) {
      throw new AppError('to, status, and orderId are required', 400);
    }
    const result = await sendPaymentEmail(req.body);
    sendSuccess(res, result);
  }));

  router.post('/internal/send-course-access-email', requireGrantAuth, asyncHandler(async (req, res) => {
    const { to, orderId } = req.body;
    if (!to || !orderId) {
      throw new AppError('to and orderId are required', 400);
    }
    const result = await sendCourseAccessEmail(req.body);
    sendSuccess(res, result);
  }));

  router.post('/internal/send-withdrawal-email', requireGrantAuth, asyncHandler(async (req, res) => {
    const { to, status, requestId, amount } = req.body;
    if (!to || !status || requestId == null || amount == null) {
      throw new AppError('to, status, requestId, and amount are required', 400);
    }
    const allowed = new Set(['created', 'approved', 'rejected']);
    if (!allowed.has(status)) {
      throw new AppError('status must be created, approved, or rejected', 400);
    }
    const result = await sendWithdrawalEmail(req.body);
    sendSuccess(res, result);
  }));

  router.post('/internal/send-membership-upgrade-email', requireGrantAuth, asyncHandler(async (req, res) => {
    const { to, membershipPlanName, orderId } = req.body;
    if (!to || !membershipPlanName || !orderId) {
      throw new AppError('to, membershipPlanName, and orderId are required', 400);
    }
    const result = await sendMembershipUpgradeEmail(req.body);
    sendSuccess(res, result);
  }));

  router.post('/internal/send-course-completion-certificate-email', requireGrantAuth, asyncHandler(async (req, res) => {
    const { to, courseTitle, completionDate } = req.body;
    if (!to || !courseTitle || !completionDate) {
      throw new AppError('to, courseTitle, and completionDate are required', 400);
    }
    const result = await sendCourseCompletionCertificateEmail(req.body);
    sendSuccess(res, result);
  }));
}

module.exports = { register };
