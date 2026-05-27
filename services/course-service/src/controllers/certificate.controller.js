const certificateService = require('../services/certificate.service');
const axios = require('axios');
const config = require('../config');
const { asyncHandler, sendSuccess, AppError, logger } = require('../../../../shared');
const PDFDocument = require('pdfkit');

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

  // Fire-and-forget: send "certificate ready" email to the learner.
  // This endpoint is called when user opens/downloads the certificate in the UI.
  (async () => {
    try {
      const contactRes = await axios.get(`${config.authServiceUrl}/internal/users/${userId}/contact`, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 8000,
      });
      const contact = contactRes?.data?.data || contactRes?.data;
      const to = contact?.email;
      if (!to) return;

      await axios.post(
        `${config.authServiceUrl}/internal/send-course-completion-certificate-email`,
        {
          to,
          name: payload.studentName,
          courseTitle: payload.courseTitle,
          completionDate: payload.completionDate,
          // Used by auth-service to fetch and attach the PDF certificate.
          userId,
          courseId: Number(req.params.courseId),
        },
        { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 15000 }
      );
    } catch (err) {
      logger.warn('[certificate-email] failed to send', {
        userId,
        courseId: req.params.courseId,
        err: err?.message || String(err),
      });
    }
  })();

  sendSuccess(res, payload);
});

function buildCertificatePdfBuffer({ studentName, courseTitle, completionDate }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Simple, readable certificate layout (server-side PDF attachment).
      doc
        .fontSize(24)
        .fillColor('#1e3a5f')
        .text('Study Cafe', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(18)
        .fillColor('#111827')
        .text('Certificate of Completion', { align: 'center' })
        .moveDown(1.5);

      doc
        .fontSize(12)
        .fillColor('#374151')
        .text('This is to certify that', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(22)
        .fillColor('#111827')
        .text(studentName || 'Learner', { align: 'center' })
        .moveDown(0.8);

      doc
        .fontSize(12)
        .fillColor('#374151')
        .text('has successfully completed the course', { align: 'center' })
        .moveDown(0.5);

      doc
        .fontSize(16)
        .fillColor('#111827')
        .text(courseTitle || 'Course', { align: 'center' })
        .moveDown(1.2);

      doc
        .fontSize(12)
        .fillColor('#374151')
        .text(`Completion date: ${completionDate || '—'}`, { align: 'center' })
        .moveDown(2);

      doc
        .fontSize(10)
        .fillColor('#6b7280')
        .text('This certificate was generated automatically.', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Internal endpoint used by auth-service to fetch a PDF to attach in email.
 * GET /internal/certificates/course/:courseId/pdf?userId=123
 */
const getCertificatePdfInternal = asyncHandler(async (req, res) => {
  const userId = Number(req.query.userId);
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(userId) || userId <= 0) throw new AppError('userId is required', 400);
  if (!Number.isFinite(courseId) || courseId <= 0) throw new AppError('courseId is invalid', 400);

  const payload = await certificateService.getCertificateDataInternal(userId, courseId);
  if (!payload) throw new AppError('Certificate not available', 404);

  const pdf = await buildCertificatePdfBuffer(payload);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${courseId}.pdf"`);
  res.status(200).send(pdf);
});

module.exports = {
  getCertificatePayload,
  getCertificatePdfInternal,
};
