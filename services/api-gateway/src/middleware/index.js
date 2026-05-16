const { rateLimit } = require('./rateLimit');
const { validateJWT, validateJWTUnlessOptions, optionalJWT, requireCourseAccess } = require('./auth');
const { errorHandler } = require('./errorHandler');

module.exports = {
  rateLimit,
  validateJWT,
  validateJWTUnlessOptions,
  optionalJWT,
  requireCourseAccess,
  errorHandler,
};
