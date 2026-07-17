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
      attributes: ['id', 'name', 'email'],
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

  router.get('/internal/users/:id/contact', requireGrantAuth, asyncHandler(async (req, res) => {
    const user = await User.findByPk(req.params.id, {
      attributes: ['id', 'name', 'email', 'phone'],
    });
    if (!user) throw new AppError('User not found', 404);
    sendSuccess(res, user.get({ plain: true }));
  }));

  router.get('/internal/users/:id/courses', requireGrantAuth, asyncHandler(async (req, res) => {
    const accountService = require('../services/account.service');
    const data = await accountService.myCourses(req.params.id);
    sendSuccess(res, data);
  }));

  router.get('/internal/users/:id/active-membership', requireGrantAuth, asyncHandler(async (req, res) => {
    const activeMembership = await accessService.getActiveMembership(req.params.id);
    sendSuccess(res, activeMembership);
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
