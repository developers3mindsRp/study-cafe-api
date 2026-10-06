const certificateLinkController = require('../controllers/certificateLink.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

/**
 * Public certificate download links.
 *
 * The `/certificate-links/:token` routes are PUBLIC — no JWT, no course access check, no
 * x-user-id. They are exposed through the gateway by explicit method+path (never a prefix mount),
 * so nothing added here later becomes world-readable by accident.
 */
function register(router) {
  // ── Public ───────────────────────────────────────────────────────
  router.get(
    '/certificate-links/:token',
    validate(schemas.certificateLinkTokenParam),
    certificateLinkController.getPublicLink,
  );
  router.post(
    '/certificate-links/:token/claim',
    validate(schemas.claimCertificateLink),
    certificateLinkController.claimCertificate,
  );
  router.post(
    '/certificate-links/:token/retrieve',
    validate(schemas.retrieveCertificateLink),
    certificateLinkController.retrieveCertificate,
  );

  // ── Internal (admin-service over internalAuth) ───────────────────
  router.get(
    '/internal/certificate-links',
    internalAuth,
    validate(schemas.listCertificateLinksQuery),
    certificateLinkController.listInternal,
  );
  router.post(
    '/internal/certificate-links',
    internalAuth,
    validate(schemas.createCertificateLink),
    certificateLinkController.createInternal,
  );
  router.get(
    '/internal/certificate-links/:id/claims',
    internalAuth,
    validate(schemas.listCertificateLinkClaimsQuery),
    certificateLinkController.listClaimsInternal,
  );
  router.get(
    '/internal/certificate-links/:id',
    internalAuth,
    validate(schemas.idParam),
    certificateLinkController.getByIdInternal,
  );
  router.put(
    '/internal/certificate-links/:id',
    internalAuth,
    validate(schemas.updateCertificateLink),
    certificateLinkController.updateInternal,
  );
  router.delete(
    '/internal/certificate-links/:id',
    internalAuth,
    validate(schemas.idParam),
    certificateLinkController.deleteInternal,
  );

  /** Certificate PDF for a link-issued certificate, attached by auth-service to the claim email. */
  router.get(
    '/internal/public-certificates/:id/pdf',
    internalAuth,
    validate(schemas.idParam),
    certificateLinkController.getPublicCertificatePdfInternal,
  );
}

module.exports = { register };
