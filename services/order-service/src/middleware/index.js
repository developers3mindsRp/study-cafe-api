const { errorHandler } = require('./errorHandler');
const { getUserId, requireUserId, optionalUserId } = require('./userId');
const { internalAuth } = require('./internalAuth');

module.exports = {
  errorHandler,
  getUserId,
  requireUserId,
  optionalUserId,
  internalAuth,
};
