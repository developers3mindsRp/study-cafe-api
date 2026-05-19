const authService = require('../services/auth.service');
const accessService = require('../services/access.service');
const { asyncHandler, AppError, sendSuccess } = require('../../../../shared');

const check = asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new AppError('Missing authorization', 401);
  }
  const token = auth.slice(7);
  const courseId = req.query.courseId;
  if (!courseId) throw new AppError('courseId required', 400);
  const result = await accessService.checkAccess(token, courseId);
  sendSuccess(res, result);
});

const grantCourse = asyncHandler(async (req, res) => {
  const { userId, courseId, orderId, expiresAt } = req.body;
  const result = await accessService.grantCourse({ userId, courseId, orderId, expiresAt });
  sendSuccess(res, result);
});

const grantMembership = asyncHandler(async (req, res) => {
  const { userId, membershipType, orderId, startsAt, expiresAt } = req.body;
  const result = await accessService.grantMembership({ userId, membershipType, orderId, startsAt, expiresAt });
  sendSuccess(res, result);
});

const revokeCourse = asyncHandler(async (req, res) => {
  const { userId, courseId, orderId } = req.body;
  const result = await accessService.revokeCourse({ userId, courseId, orderId });
  sendSuccess(res, result);
});

const revokeMembership = asyncHandler(async (req, res) => {
  const { userId, orderId } = req.body;
  const result = await accessService.revokeMembership({ userId, orderId });
  sendSuccess(res, result);
});

module.exports = { check, grantCourse, revokeCourse, grantMembership, revokeMembership };
