const courseReviewsService = require('../services/courseReviews.service');
const { asyncHandler, sendSuccess, sendPaginated, sendNoContent, AppError } = require('../../../../shared');

function userIdFromReq(req) {
  const h = req.headers['x-user-id'];
  const n = h != null ? Number(h) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new AppError('Missing user', 401);
  return n;
}

/** POST body: courseId (or course_id), rating, body */
const submitReview = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const auth = req.headers.authorization;
  const courseId = req.body.courseId ?? req.body.course_id;
  const { rating } = req.body;
  const { body: textBody } = req.body;
  const row = await courseReviewsService.upsertMyReview(
    userId,
    courseId,
    rating,
    textBody,
    auth
  );
  sendSuccess(res, row);
});

const getMineForCourse = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const row = await courseReviewsService.getMyReview(userId, req.params.courseId);
  sendSuccess(res, row || null);
});

const listPublicByCourse = asyncHandler(async (req, res) => {
  const limit = req.query.limit;
  const data = await courseReviewsService.listReviewsForCourse(req.params.courseId, { limit });
  sendSuccess(res, data);
});

// ── Internal (admin proxy) ────────────────────────────────────────

const listInternal = asyncHandler(async (req, res) => {
  const result = await courseReviewsService.listReviewsAdmin(req.query || {});
  sendPaginated(res, {
    data: result.data,
    meta: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      hasNextPage: result.hasNextPage,
      hasPreviousPage: result.hasPreviousPage,
    },
  });
});

const getInternal = asyncHandler(async (req, res) => {
  const row = await courseReviewsService.getReviewByIdAdmin(req.params.id);
  if (!row) throw new AppError('Review not found', 404);
  sendSuccess(res, row);
});

const patchInternal = asyncHandler(async (req, res) => {
  const row = await courseReviewsService.adminUpdateReview(req.params.id, req.body || {});
  sendSuccess(res, row);
});

const deleteInternal = asyncHandler(async (req, res) => {
  await courseReviewsService.adminDeleteReview(req.params.id);
  sendNoContent(res);
});

module.exports = {
  submitReview,
  getMineForCourse,
  listPublicByCourse,
  listInternal,
  getInternal,
  patchInternal,
  deleteInternal,
};
