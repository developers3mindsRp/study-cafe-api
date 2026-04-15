const affiliateController = require('../controllers/affiliate.controller');
const { internalAuth } = require('../middleware');

function register(router) {
  // Internal routes for admin proxy
  router.get('/internal/affiliate/history', internalAuth, affiliateController.getHistory);
  router.get('/internal/affiliate/withdrawals', internalAuth, affiliateController.getWithdrawals);
  router.get('/internal/affiliate/balance/:userId', internalAuth, affiliateController.getBalance);
  router.post('/internal/affiliate/withdrawals', internalAuth, affiliateController.createWithdrawal);
  router.patch('/internal/affiliate/withdrawals/:id', internalAuth, affiliateController.updateWithdrawalStatus);
}

module.exports = { register };
