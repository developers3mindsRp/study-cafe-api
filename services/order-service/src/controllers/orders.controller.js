const ordersService = require('../services/orders.service');
const { asyncHandler, AppError, sendSuccess, sendCreated } = require('../../../../shared');

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

const listAllInternal = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const offset = parseInt(req.query.offset || '0', 10);
  const rows = await ordersService.listAllOrders(limit, offset);
  sendSuccess(res, rows);
});

const getByOrderIdInternal = asyncHandler(async (req, res) => {
  const order = await ordersService.getOrderByOrderId(req.params.orderId);
  if (!order) throw new AppError('Order not found', 404);
  sendSuccess(res, order);
});

module.exports = {
  create,
  verify,
  list,
  listMyPurchases,
  getCoupons,
  applyCoupon,
  getInvoice,
  listAllInternal,
  getByOrderIdInternal,
};
