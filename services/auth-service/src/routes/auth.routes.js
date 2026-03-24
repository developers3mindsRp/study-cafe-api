const authController = require('../controllers/auth.controller');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.post('/auth/register', validate(schemas.register), authController.register);
  router.post('/auth/login', validate(schemas.login), authController.login);
  router.get('/auth/validate', authController.validate);
  router.get('/auth/me', authController.me);
  router.post('/auth/refresh', validate(schemas.refreshToken), authController.refresh);
  router.post('/auth/change-password', validate(schemas.changePassword), authController.changePassword);
}

module.exports = { register };
