const ordersService = require('../services/orders.service');
const webhookService = require('../services/webhook.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent, logger } = require('../../../../shared');

const create = asyncHandler(async (req, res) => {
  const result = await ordersService.createOrder(req.userId, req.body);
  sendCreated(res, result);
});

const verify = asyncHandler(async (req, res) => {
  const result = await ordersService.verifyOrder(req.userId, req.body);
  sendSuccess(res, result);
});

const list = asyncHandler(async (req, res) => {
  const rows = await ordersService.listOrders(req.userId);
  sendSuccess(res, rows);
});

const getCoupons = asyncHandler(async (req, res) => {
  const coupons = await ordersService.getCouponsForEntity(req.userId, req.query.type, req.query.id);
  sendSuccess(res, coupons);
});

const applyCoupon = asyncHandler(async (req, res) => {
  const result = await ordersService.applyCoupon(req.userId, req.body);
  sendSuccess(res, result);
});

const listMyPurchases = asyncHandler(async (req, res) => {
  const rows = await ordersService.listMyPurchases(req.userId);
  sendSuccess(res, rows);
});

const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await ordersService.getInvoice(req.userId, req.params.orderId);
  if (!invoice) throw new AppError('Order not found', 404);
  sendSuccess(res, invoice);
});

const getCouponUsageSummaryInternal = asyncHandler(async (req, res) => {
  const summary = await ordersService.getCouponUsageSummary();
  sendSuccess(res, summary);
});

const listCouponUsagesInternal = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);
  const {
    search,
    sortBy,
    sortOrder,
    dateFrom,
    dateTo,
    couponCode,
    couponId,
    status,
    type,
  } = req.query;

  const result = await ordersService.listCouponUsages({
    limit,
    offset,
    search,
    sortBy,
    sortOrder,
    dateFrom,
    dateTo,
    couponCode,
    couponId,
    status,
    type,
  });
  sendSuccess(res, result);
});

const getOrderStatsInternal = asyncHandler(async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const data = await ordersService.getOrderStats({ dateFrom, dateTo });
  sendSuccess(res, data);
});

const getRevenueTimeSeriesInternal = asyncHandler(async (req, res) => {
  const { dateFrom, dateTo, bucket } = req.query;
  const data = await ordersService.getRevenueTimeSeries({ dateFrom, dateTo, bucket });
  sendSuccess(res, data);
});

const listAllInternal = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);
  const {
    search,
    sortBy,
    sortOrder,
    dateFrom,
    dateTo,
    courseId,
    type,
    amountMin,
    amountMax,
    status,
    trashed,
    course_access: courseAccess,
  } = req.query;

  const result = await ordersService.listAllOrders({
    limit,
    offset,
    search,
    sortBy,
    sortOrder,
    dateFrom,
    dateTo,
    courseId,
    type,
    amountMin,
    amountMax,
    status,
    trashed,
    courseAccess,
  });
  sendSuccess(res, result);
});

const refundOrder = asyncHandler(async (req, res) => {
  const result = await ordersService.refundOrder(req.params.id, req.body);
  sendSuccess(res, result);
});

const getByOrderIdInternal = asyncHandler(async (req, res) => {
  const order = await ordersService.getOrderByOrderId(req.params.orderId);
  if (!order) throw new AppError('Order not found', 404);
  sendSuccess(res, order);
});

const createManualOrder = asyncHandler(async (req, res) => {
  const result = await ordersService.createManualOrder(req.body);
  sendCreated(res, result);
});

const updateOrder = asyncHandler(async (req, res) => {
  const result = await ordersService.updateOrder(req.params.id, req.body);
  if (!result) throw new AppError('Order not found', 404);
  sendSuccess(res, result);
});

const deleteOrder = asyncHandler(async (req, res) => {
  const result = await ordersService.deleteOrder(req.params.id);
  if (!result) throw new AppError('Order not found', 404);
  sendNoContent(res);
});

const restoreOrder = asyncHandler(async (req, res) => {
  const result = await ordersService.restoreOrder(req.params.id);
  if (!result) throw new AppError('Order not found in trash', 404);
  sendSuccess(res, result);
});

const webhook = asyncHandler(async (req, res) => {
  const rawBody = req.rawBody;
  const signature = req.headers['x-razorpay-signature'] || '';

  logger.info(`[WEBHOOK-CTRL] Received webhook — has rawBody: ${!!rawBody}, rawBody length: ${rawBody ? rawBody.length : 0}, has signature: ${!!signature}, signature length: ${signature.length}`);
  logger.info(`[WEBHOOK-CTRL] Content-Type: ${req.headers['content-type']}, User-Agent: ${req.headers['user-agent']}`);

  if (!rawBody || !signature) {
    logger.warn(`[WEBHOOK-CTRL] Rejected — missing ${!rawBody ? 'rawBody' : ''} ${!signature ? 'signature' : ''}`);
    return res.status(400).json({ status: 'missing_signature_or_body' });
  }

  const { statusCode, body } = await webhookService.processWebhook(rawBody, signature, req.body);
  logger.info(`[WEBHOOK-CTRL] Response — status: ${statusCode}, body: ${JSON.stringify(body)}`);
  res.status(statusCode).json(body);
});

const createPaymentLink = asyncHandler(async (req, res) => {
  const uid = req.userId != null ? req.userId : null;
  const result = await ordersService.createPaymentLinkOrder(uid, req.body);
  sendCreated(res, result);
});

const verifyPaymentLink = asyncHandler(async (req, res) => {
  const result = await ordersService.verifyPaymentLinkOrder(req.body);
  sendSuccess(res, result);
});

const listActiveCoupons = asyncHandler(async (req, res) => {
  const coupons = await ordersService.listActiveCoupons();
  sendSuccess(res, coupons);
});

// ── Admin coupon CRUD ────────────────────────────────────────────────────────

const listAllCoupons = asyncHandler(async (req, res) => {
  const coupons = await ordersService.listAllCoupons();
  sendSuccess(res, coupons);
});

const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await ordersService.createCoupon(req.body);
  sendCreated(res, coupon);
});

const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await ordersService.updateCoupon(req.params.id, req.body);
  if (!coupon) throw new AppError('Coupon not found', 404);
  sendSuccess(res, coupon);
});

const deleteCoupon = asyncHandler(async (req, res) => {
  const result = await ordersService.deleteCoupon(req.params.id);
  if (!result) throw new AppError('Coupon not found', 404);
  sendNoContent(res);
});

const getUserPurchasesInternal = asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  if (!userId) throw new AppError('userId is required', 400);
  const rows = await ordersService.listMyPurchases(userId);
  sendSuccess(res, rows);
});

const validateCouponPreviewInternal = asyncHandler(async (req, res) => {
  const { userId, couponCode, amount, type } = req.body;
  if (!couponCode || amount == null || !type) {
    throw new AppError('couponCode, amount and type are required', 400);
  }
  const result = await ordersService.validateCouponForPreview(userId, couponCode, amount, type);
  sendSuccess(res, result);
});

module.exports = {
  create,
  verify,
  list,
  listMyPurchases,
  getCoupons,
  applyCoupon,
  getInvoice,
  getOrderStatsInternal,
  getRevenueTimeSeriesInternal,
  listAllInternal,
  listCouponUsagesInternal,
  getCouponUsageSummaryInternal,
  getByOrderIdInternal,
  listActiveCoupons,
  listAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  webhook,
  createPaymentLink,
  verifyPaymentLink,
  createManualOrder,
  updateOrder,
  deleteOrder,
  restoreOrder,
  refundOrder,
  getUserPurchasesInternal,
  validateCouponPreviewInternal,
};
