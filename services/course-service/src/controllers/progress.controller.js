const progressService = require('../services/progress.service');
const { asyncHandler, sendSuccess, AppError } = require('../../../../shared');

function userIdFromReq(req) {
  const h = req.headers['x-user-id'];
  const n = h != null ? Number(h) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new AppError('Missing user', 401);
  return n;
}

const getCourseProgress = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const auth = req.headers.authorization;
  const data = await progressService.getCourseProgress(req.params.courseId, userId, auth);
  sendSuccess(res, data);
});

const heartbeat = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const auth = req.headers.authorization;
  const row = await progressService.heartbeatSession(req.params.sessionId, userId, req.body || {}, auth);
  sendSuccess(res, row);
});

const complete = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const auth = req.headers.authorization;
  const data = await progressService.completeSession(req.params.sessionId, userId, auth);
  sendSuccess(res, data);
});

const overall = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const auth = req.headers.authorization;
  const rows = await progressService.getOverallProgress(userId, auth);
  sendSuccess(res, rows);
});

const internalSummary = asyncHandler(async (req, res) => {
  const { userId, courseIds } = req.body || {};
  const data = await progressService.internalProgressSummary({
    userId: Number(userId),
    courseIds: Array.isArray(courseIds) ? courseIds : [],
  });
  sendSuccess(res, data);
});

module.exports = {
  getCourseProgress,
  heartbeat,
  complete,
  overall,
  internalSummary,
};
