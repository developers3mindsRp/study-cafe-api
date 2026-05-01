const affiliateController = require('../controllers/affiliate.controller');
const { internalAuth } = require('../middleware');

function register(router) {
  // Internal routes for admin proxy
  router.get('/internal/affiliate/history', internalAuth, affiliateController.getHistory);
  router.get('/internal/affiliate/withdrawals', internalAuth, affiliateController.getWithdrawals);
  router.get('/internal/affiliate/balance/:userId', internalAuth, affiliateController.getBalance);
  router.post('/internal/affiliate/withdrawals', internalAuth, affiliateController.createWithdrawal);
  router.patch('/internal/affiliate/withdrawals/:id', internalAuth, affiliateController.updateWithdrawalStatus);
  router.post('/internal/affiliate/record-commission', internalAuth, affiliateController.recordCommission);

  // User-facing routes (auth via X-User-Id from gateway)
  router.get('/affiliate/my-dashboard', affiliateController.getMyAffiliate);
  router.get('/affiliate/my-orders', affiliateController.getMyCommissionOrders);
  router.get('/affiliate/my-links', affiliateController.getMyReferralLinks);
  router.get('/affiliate/my-withdrawals', affiliateController.getMyWithdrawals);
  router.post('/affiliate/my-withdrawals', affiliateController.createMyWithdrawal);
}

module.exports = { register };
