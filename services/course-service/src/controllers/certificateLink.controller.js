const certificateLinkService = require('../services/publicCertificateLink.service');
const { buildCertificatePdfBuffer } = require('../services/certificatePdf.service');
const { asyncHandler, sendSuccess, sendCreated, sendPaginated, AppError } = require('../../../../shared');

/**
 * Client IP for the claim throttle buckets.
 *
 * Read defensively instead of trusting req.ip: these routes arrive through the api-gateway proxy,
 * and they only carry the caller's real address because that proxy is created with `xfwd: true`.
 * If that flag is ever dropped, every claim looks like it came from the gateway and the per-IP
 * bucket turns into a platform-wide lockout — see proxy.routes.js.
 */
function clientIpFrom(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  return forwarded || req.ip || req.socket?.remoteAddress || null;
}

// ── Public (unauthenticated) ───────────────────────────────────────

/**
 * GET /certificate-links/:token
 *
 * Returns 200 with a `status` of active | expired | full rather than 410 for a closed link, so the
 * page can render friendly copy off the success path. 404 only for links that should not be known
 * to exist at all (unknown token, draft, soft-deleted).
 */
const getPublicLink = asyncHandler(async (req, res) => {
  const data = await certificateLinkService.getPublicByToken(req.params.token);
  sendSuccess(res, data);
});

/**
 * POST /certificate-links/:token/claim
 *
 * Returns { courseTitle, studentName, completionDate, certificateNumber } — the same shape as the
 * learner certificate endpoint, so one artwork component renders both.
 */
const claimCertificate = asyncHandler(async (req, res) => {
  try {
    const data = await certificateLinkService.claim(req.params.token, req.body, {
      ip: clientIpFrom(req),
      userAgent: req.headers['user-agent'] || null,
    });
    sendSuccess(res, data);
  } catch (err) {
    // The throttle buckets carry their own cool-off, so tell the caller how long to wait.
    if (err?.statusCode === 429 && err.retryAfter) {
      res.setHeader('Retry-After', String(err.retryAfter));
    }
    throw err;
  }
});

// ── Internal (admin-service, internalAuth) ─────────────────────────

const listInternal = asyncHandler(async (req, res) => {
  const result = await certificateLinkService.listInternal(req.query);
  // Paginated: pass the { data, meta } envelope through — admin-service's courseClient only
  // unwraps responses WITHOUT a `meta` key, and the admin DataTable expects the envelope.
  sendPaginated(res, result);
});

const getByIdInternal = asyncHandler(async (req, res) => {
  const row = await certificateLinkService.getByIdInternal(req.params.id);
  if (!row) throw new AppError('Certificate link not found', 404);
  sendSuccess(res, row);
});

const createInternal = asyncHandler(async (req, res) => {
  const { created_by: createdBy, ...body } = req.body;
  const row = await certificateLinkService.createInternal(body, createdBy ?? null);
  sendCreated(res, row);
});

const updateInternal = asyncHandler(async (req, res) => {
  const row = await certificateLinkService.updateInternal(req.params.id, req.body);
  if (!row) throw new AppError('Certificate link not found', 404);
  sendSuccess(res, row);
});

const deleteInternal = asyncHandler(async (req, res) => {
  const ok = await certificateLinkService.deleteInternal(req.params.id);
  if (!ok) throw new AppError('Certificate link not found', 404);
  sendSuccess(res, { deleted: true });
});

const listClaimsInternal = asyncHandler(async (req, res) => {
  const result = await certificateLinkService.listClaimsInternal(req.params.id, req.query);
  if (!result) throw new AppError('Certificate link not found', 404);
  sendPaginated(res, result);
});

/**
 * GET /internal/public-certificates/:id/pdf
 *
 * The PDF auth-service attaches to a claim email. The learner equivalent
 * (/internal/certificates/course/:courseId/pdf) cannot serve this: it requires completed course
 * progress, and an anonymous claimant has none.
 */
const getPublicCertificatePdfInternal = asyncHandler(async (req, res) => {
  const payload = await certificateLinkService.getPublicCertificateForPdf(req.params.id);
  if (!payload) throw new AppError('Certificate not found', 404);

  const pdf = await buildCertificatePdfBuffer(payload);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${req.params.id}.pdf"`);
  res.status(200).send(pdf);
});

module.exports = {
  getPublicLink,
  claimCertificate,
  listInternal,
  getByIdInternal,
  createInternal,
  updateInternal,
  deleteInternal,
  listClaimsInternal,
  getPublicCertificatePdfInternal,
};
