const ordersController = require('../controllers/orders.controller');
const { requireUserId, optionalUserId, internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.post('/orders/webhook/razorpay', ordersController.webhook);

  // Public — no auth required, frontend uses this to display available coupons
  router.get('/coupons', ordersController.listActiveCoupons);

  router.post('/orders/payment-link/create', optionalUserId, validate(schemas.paymentLinkCreateOrder), ordersController.createPaymentLink);
  router.post('/orders/payment-link/verify', validate(schemas.paymentLinkVerifyOrder), ordersController.verifyPaymentLink);

  router.post('/orders/create', requireUserId, validate(schemas.createOrder), ordersController.create);
  router.post('/orders/verify', requireUserId, validate(schemas.verifyOrder), ordersController.verify);
  router.get('/orders', requireUserId, ordersController.list);
  router.get('/orders/my-purchases', requireUserId, ordersController.listMyPurchases);
  router.get('/orders/get-coupon', optionalUserId, validate(schemas.getCoupon), ordersController.getCoupons);
  router.post('/orders/apply-coupon', optionalUserId, validate(schemas.applyCoupon), ordersController.applyCoupon);
  router.get('/order/get-coupon', optionalUserId, validate(schemas.getCoupon), ordersController.getCoupons);
  router.post('/order/apply-coupon', optionalUserId, validate(schemas.applyCoupon), ordersController.applyCoupon);
  router.get('/orders/:orderId/invoice', requireUserId, validate(schemas.invoiceParam), ordersController.getInvoice);
  router.get('/internal/orders', internalAuth, ordersController.listAllInternal);
  router.get('/internal/coupon-usages', internalAuth, ordersController.listCouponUsagesInternal);
  router.get('/internal/coupon-usages/summary', internalAuth, ordersController.getCouponUsageSummaryInternal);
  router.get('/internal/orders/:orderId', internalAuth, ordersController.getByOrderIdInternal);
  router.post('/internal/orders', internalAuth, ordersController.createManualOrder);
  router.put('/internal/orders/:id', internalAuth, ordersController.updateOrder);
  router.post('/internal/orders/:id/refund', internalAuth, ordersController.refundOrder);
  router.delete('/internal/orders/:id', internalAuth, ordersController.deleteOrder);
  router.get('/internal/users/:userId/purchases', internalAuth, ordersController.getUserPurchasesInternal);


  // Internal coupon management (called by admin-service)
  router.get('/internal/coupons', internalAuth, ordersController.listAllCoupons);
  router.post('/internal/coupons', internalAuth, ordersController.createCoupon);
  router.put('/internal/coupons/:id', internalAuth, ordersController.updateCoupon);
  router.delete('/internal/coupons/:id', internalAuth, ordersController.deleteCoupon);
  // Preview-only coupon validation for upgrade-summary (no usage recorded)
  router.post('/internal/coupons/validate-preview', internalAuth, ordersController.validateCouponPreviewInternal);
}

module.exports = { register };
