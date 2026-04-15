const ordersController = require('../controllers/orders.controller');
const { requireUserId, optionalUserId, internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
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
  router.get('/internal/orders/:orderId', internalAuth, ordersController.getByOrderIdInternal);
}

module.exports = { register };
