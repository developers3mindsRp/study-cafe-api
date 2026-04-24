const accountService = require('../services/account.service');
const { asyncHandler, sendSuccess, sendNoContent, AppError } = require('../../../../shared');
const { uploadDir } = require('../middleware/avatarUpload');
const { relativePathFromFile, publicMediaUrl } = require('../../../../shared/mediaUrl');

const getProfile = asyncHandler(async (req, res) => {
  const data = await accountService.getProfile(req.user.userId);
  sendSuccess(res, data);
});

const updateProfile = asyncHandler(async (req, res) => {
  const data = await accountService.updateProfile(req.user.userId, req.body);
  sendSuccess(res, data);
});

const deleteAccount = asyncHandler(async (req, res) => {
  await accountService.deleteAccount(req.user.userId);
  sendNoContent(res);
});

const dashboardStats = asyncHandler(async (req, res) => {
  const data = await accountService.dashboardStats(req.user.userId);
  sendSuccess(res, data);
});

const myCourses = asyncHandler(async (req, res) => {
  const data = await accountService.myCourses(req.user.userId);
  sendSuccess(res, data);
});

/** After multer — req.file */
const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400);
  const rel = relativePathFromFile(uploadDir, req.file.path);
  const url = publicMediaUrl(rel, 'user');
  await accountService.updateAvatarUrl(req.user.userId, url);
  sendSuccess(res, { url });
});

const getSubscription = asyncHandler(async (req, res) => {
  const data = await accountService.getSubscription(req.user.userId);
  sendSuccess(res, data);
});

const getMembershipCourses = asyncHandler(async (req, res) => {
  const data = await accountService.getMembershipCourses(req.user.userId);
  sendSuccess(res, data);
});

module.exports = {
  getProfile,
  updateProfile,
  deleteAccount,
  dashboardStats,
  myCourses,
  uploadAvatar,
  getSubscription,
  getMembershipCourses,
};
