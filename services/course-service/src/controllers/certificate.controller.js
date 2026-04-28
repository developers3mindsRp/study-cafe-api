const certificateService = require('../services/certificate.service');
const { asyncHandler, sendSuccess, AppError } = require('../../../../shared');

function userIdFromReq(req) {
  const h = req.headers['x-user-id'];
  const n = h != null ? Number(h) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new AppError('Missing user', 401);
  return n;
}

/** JSON payload for client-side certificate: courseTitle, studentName, completionDate (YYYY-MM-DD). */
const getCertificatePayload = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const auth = req.headers.authorization;
  const payload = await certificateService.getCertificateData(userId, req.params.courseId, auth);
  if (!payload) throw new AppError('Certificate not available', 404);
  sendSuccess(res, payload);
});

module.exports = {
  getCertificatePayload,
};
