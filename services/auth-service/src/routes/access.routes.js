const accessController = require('../controllers/access.controller');
const accessService = require('../services/access.service');
const { requireGrantAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');
const { User } = require('../models');
const { asyncHandler, sendSuccess, AppError } = require('../../../../shared');

function register(router) {
  router.get('/access/check', validate(schemas.checkAccess), accessController.check);
  router.post('/access/grant-course', requireGrantAuth, validate(schemas.grantCourse), accessController.grantCourse);
  router.post('/access/grant-membership', requireGrantAuth, validate(schemas.grantMembership), accessController.grantMembership);

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
}

module.exports = { register };
