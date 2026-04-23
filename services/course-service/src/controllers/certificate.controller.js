const fs = require('fs');
const path = require('path');
const certificateService = require('../services/certificate.service');
const { asyncHandler, sendSuccess, AppError } = require('../../../../shared');

function userIdFromReq(req) {
  const h = req.headers['x-user-id'];
  const n = h != null ? Number(h) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new AppError('Missing user', 401);
  return n;
}

const download = asyncHandler(async (req, res) => {
  const userId = userIdFromReq(req);
  const courseId = Number(req.params.courseId);
  const file = await certificateService.getCertificateForDownload(userId, courseId);
  if (!file) throw new AppError('Certificate not found', 404);
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${file.certificateNumber}.pdf"`);
  fs.createReadStream(file.absPath).pipe(res);
});

const verify = asyncHandler(async (req, res) => {
  const data = await certificateService.verifyByToken(req.params.token);
  if (!data) throw new AppError('Certificate not found', 404);
  sendSuccess(res, data);
});

module.exports = { download, verify };
