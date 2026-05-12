const { errorHandler } = require('./errorHandler');
const { requireGrantAuth } = require('./grantAuth');
const { internalAuth } = require('./internalAuth');

module.exports = {
  errorHandler,
  requireGrantAuth,
  internalAuth,
};
