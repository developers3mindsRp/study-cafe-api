const accessController = require('../controllers/access.controller');
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
}

module.exports = { register };
