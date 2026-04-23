const progressController = require('../controllers/progress.controller');
const certificateController = require('../controllers/certificate.controller');
const { internalAuth } = require('../middleware');

function register(router) {
  router.get('/progress/course/:courseId', progressController.getCourseProgress);
  router.post('/progress/session/:sessionId/heartbeat', progressController.heartbeat);
  router.post('/progress/session/:sessionId/complete', progressController.complete);
  router.get('/progress/overall', progressController.overall);

  router.post('/internal/progress/summary', internalAuth, progressController.internalSummary);

  router.get('/certificates/course/:courseId/download', certificateController.download);
  router.get('/certificates/verify/:token', certificateController.verify);
}

module.exports = { register };
