const progressController = require('../controllers/progress.controller');
const certificateController = require('../controllers/certificate.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.get('/progress/course/:courseId', progressController.getCourseProgress);
  router.post('/progress/session/:sessionId/heartbeat', progressController.heartbeat);
  router.post('/progress/session/:sessionId/complete', progressController.complete);
  router.get('/progress/overall', progressController.overall);

  router.post('/internal/progress/summary', internalAuth, progressController.internalSummary);

  router.get(
    '/certificates/course/:courseId',
    validate(schemas.certificateCourseIdParam),
    certificateController.getCertificatePayload
  );
}

module.exports = { register };
