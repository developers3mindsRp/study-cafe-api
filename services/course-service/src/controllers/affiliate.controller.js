const affiliateService = require('../services/affiliate.service');
const { asyncHandler, sendSuccess, sendCreated, AppError } = require('../../../../shared');

const getHistory = asyncHandler(async (req, res) => {
  const data = await affiliateService.getHistory();
  sendSuccess(res, data);
});

const getWithdrawals = asyncHandler(async (req, res) => {
  const data = await affiliateService.getWithdrawals();
  sendSuccess(res, data);
});

const getBalance = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (!userId) throw new AppError('User ID is required', 400);
  const data = await affiliateService.getBalance(userId);
  sendSuccess(res, data);
});

const createWithdrawal = asyncHandler(async (req, res) => {
  const request = await affiliateService.createWithdrawal(req.body);
  sendCreated(res, request);
});

const updateWithdrawalStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await affiliateService.updateWithdrawalStatus(id, req.body);
  sendSuccess(res, result);
});

const recordCommission = asyncHandler(async (req, res) => {
  const result = await affiliateService.recordCommission(req.body);
  sendSuccess(res, result);
});

const getMyAffiliate = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Authentication required', 401);
  const data = await affiliateService.getMyAffiliateData(userId);
  sendSuccess(res, data);
});

const getMyCommissionOrders = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Authentication required', 401);
  const { from, to } = req.query;
  const data = await affiliateService.getMyCommissionOrders(userId, { from, to });
  sendSuccess(res, data);
});

const getMyReferralLinks = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Authentication required', 401);
  // Use header code if present, otherwise look it up / auto-generate
  const headerCode = req.headers['x-referral-code'] || req.query.code;
  const referralCode = await affiliateService.resolveReferralCode(userId, headerCode);
  const data = await affiliateService.getReferralLinks(userId, referralCode);
  sendSuccess(res, data);
});

const createMyWithdrawal = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Authentication required', 401);
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount)) throw new AppError('Valid amount is required', 400);
  const request = await affiliateService.createWithdrawal({
    affiliate_id: userId,
    amount,
  }, { enforceMinWithdrawal: true });
  sendCreated(res, request);
});

const getMyWithdrawals = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Authentication required', 401);
  const data = await affiliateService.getMyWithdrawals(userId);
  sendSuccess(res, data);
});

module.exports = {
  getHistory,
  getWithdrawals,
  getBalance,
  createWithdrawal,
  updateWithdrawalStatus,
  recordCommission,
  getMyAffiliate,
  getMyCommissionOrders,
  getMyReferralLinks,
  createMyWithdrawal,
  getMyWithdrawals,
};
