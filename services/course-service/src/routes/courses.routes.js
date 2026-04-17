const coursesController = require('../controllers/courses.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  // Public routes
  router.get('/courses', coursesController.list);
  router.get('/course-cats', coursesController.listCourseCatsPublic);
  router.get('/courses/by-category', coursesController.listByCategory);
  // Static path before /:id — "featured" is not a numeric id
  router.get('/courses/featured', coursesController.listFeatured);
  // Slug-based lookup (must be before /:id to avoid being caught as a numeric id)
  router.get('/courses/slug/:slug', coursesController.getBySlug);
  router.get('/courses/slug/:slug/sessions', coursesController.getSessionsBySlug);
  router.get('/courses/:id', validate(schemas.idParam), coursesController.getById);
  router.get('/courses/:id/sessions', validate(schemas.idParam), coursesController.getSessions);
  router.get('/courses/:id/materials', validate(schemas.idParam), coursesController.getMaterials);

  // Internal routes (admin proxy)
  router.post('/internal/courses/by-ids', internalAuth, coursesController.listByIdsOrCatIds);
  router.get('/internal/courses', internalAuth, coursesController.listAllInternal);
  router.get('/internal/courses/:id', internalAuth, validate(schemas.idParam), coursesController.getByIdInternal);
  router.get('/internal/courses/:id/sessions', internalAuth, validate(schemas.idParam), coursesController.getSessionsInternal);
  router.get('/internal/course-cats', internalAuth, coursesController.listCourseCatsInternal);
  router.post('/internal/course-cats', internalAuth, coursesController.createCourseCat);
  router.put('/internal/course-cats/:id', internalAuth, coursesController.updateCourseCat);
  router.delete('/internal/course-cats/:id', internalAuth, coursesController.deleteCourseCat);
  router.post('/internal/courses', internalAuth, validate(schemas.createCourse), coursesController.createCourse);
  router.put('/internal/courses/:id', internalAuth, validate(schemas.updateCourse), coursesController.updateCourse);
  router.post('/internal/courses/:id/batches', internalAuth, validate(schemas.createBatch), coursesController.createBatch);
  // List batches (paginated) — must be registered before /internal/batches/:id routes
  router.get('/internal/batches', internalAuth, validate(schemas.listBatchesQuery), coursesController.listBatchesAdmin);
  router.get('/internal/batches/:id', internalAuth, validate(schemas.idParam), coursesController.getBatchByIdInternal);
  router.put('/internal/batches/:id', internalAuth, validate(schemas.updateBatch), coursesController.updateBatch);
  router.post('/internal/batches/:id/sync', internalAuth, validate(schemas.idParam), coursesController.syncBatch);
  router.post('/internal/batches/:id/sessions', internalAuth, validate(schemas.createSession), coursesController.createSession);
  router.put('/internal/sessions/:id', internalAuth, validate(schemas.updateSession), coursesController.updateSession);
  router.post('/internal/sessions/:id/recordings', internalAuth, validate(schemas.addRecording), coursesController.addRecording);
  router.put('/internal/recordings/:id', internalAuth, validate(schemas.updateRecording), coursesController.updateRecording);
  router.post('/internal/courses/:id/materials', internalAuth, validate(schemas.addMaterial), coursesController.addMaterial);

  // Recording visibility & delete
  router.put('/internal/recordings/:id/visibility', internalAuth, validate(schemas.toggleVisibility), coursesController.toggleRecordingVisibility);
  router.delete('/internal/recordings/:id', internalAuth, validate(schemas.idParam), coursesController.deleteRecording);
  router.delete('/internal/sessions/:id', internalAuth, validate(schemas.idParam), coursesController.deleteSession);
  router.delete('/internal/batches/:id', internalAuth, validate(schemas.idParam), coursesController.deleteBatch);

  // Batch enrollments
  router.get('/internal/batches/:id/enrollments', internalAuth, validate(schemas.idParam), coursesController.getBatchEnrollments);
  router.post('/internal/batches/:id/enrollments', internalAuth, validate(schemas.addBatchEnrollment), coursesController.addBatchEnrollment);
  router.delete('/internal/batch-enrollments/:id', internalAuth, validate(schemas.idParam), coursesController.removeBatchEnrollment);
  router.post('/internal/courses/:id/auto-enroll', internalAuth, validate(schemas.autoEnrollBatch), coursesController.autoEnrollBatch);
  router.get('/internal/courses/:id/select-purchase-batch', internalAuth, validate(schemas.idParam), coursesController.selectPurchaseBatch);

  // Course Page Settings
  router.get('/internal/course-page-settings', internalAuth, coursesController.getPageSettings);
  router.put('/internal/course-page-settings/:key', internalAuth, validate(schemas.updatePageSetting), coursesController.updatePageSetting);
}

module.exports = { register };
