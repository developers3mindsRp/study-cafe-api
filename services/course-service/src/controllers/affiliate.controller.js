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

module.exports = {
  getHistory,
  getWithdrawals,
  getBalance,
  createWithdrawal,
  updateWithdrawalStatus
};
