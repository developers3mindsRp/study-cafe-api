const authController = require('../controllers/auth.controller');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.post('/auth/register', validate(schemas.register), authController.register);
  router.post('/auth/login', validate(schemas.login), authController.login);
  router.post('/auth/login/otp/request', validate(schemas.loginOtpRequest), authController.loginRequestOtp);
  router.post('/auth/login/otp', validate(schemas.loginOtp), authController.loginWithOtp);
  router.post('/auth/forgot-password', validate(schemas.forgotPassword), authController.forgotPassword);
  router.post('/auth/reset-password', validate(schemas.resetPassword), authController.resetPassword);
  router.post('/auth/verify-email/resend', authController.resendVerificationEmail);
  router.post('/auth/verify-email', validate(schemas.verifyEmailOtp), authController.verifyEmail);
  router.get('/auth/validate', authController.validate);
  router.get('/auth/me', authController.me);
  router.post('/auth/refresh', validate(schemas.refreshToken), authController.refresh);
  router.post('/auth/change-password', validate(schemas.changePassword), authController.changePassword);
}

module.exports = { register };
