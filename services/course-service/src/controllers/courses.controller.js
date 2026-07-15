const coursesService = require('../services/courses.service');
const previewTokenService = require('../services/previewToken.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendPaginated, sendNoContent } = require('../../../../shared');

const list = asyncHandler(async (req, res) => {
  const rows = await coursesService.listPublished();
  sendSuccess(res, rows);
});

const listFeatured = asyncHandler(async (req, res) => {
  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 6));
  const rows = await coursesService.listFeaturedPublished(limit);
  sendSuccess(res, rows);
});

const getById = asyncHandler(async (req, res) => {
  const course = await coursesService.getById(req.params.id, {
    authorization: req.headers.authorization,
    previewToken: req.query.preview_token || null,
  });
  if (!course) throw new AppError('Course not found', 404);
  sendSuccess(res, course);
});

const getBySlug = asyncHandler(async (req, res) => {
  const course = await coursesService.getBySlug(req.params.slug, {
    authorization: req.headers.authorization,
    previewToken: req.query.preview_token || null,
  });
  if (!course) throw new AppError('Course not found', 404);
  sendSuccess(res, course);
});

const getSessions = asyncHandler(async (req, res) => {
  const result = await coursesService.getSessionsByCourseId(req.params.id, {
    authorization: req.headers.authorization,
  });
  if (result === null) throw new AppError('Course not found', 404);
  sendSuccess(res, result);
});

const getSessionsBySlug = asyncHandler(async (req, res) => {
  // optionalJWT in gateway sets x-user-id if a valid token was present.
  const userIdHeader = req.headers['x-user-id'];
  const userId = userIdHeader ? Number(userIdHeader) : null;
  const result = await coursesService.getSessionsBySlug(req.params.slug, {
    userId: Number.isFinite(userId) && userId > 0 ? userId : null,
    authorization: req.headers.authorization,
  });
  if (result === null) throw new AppError('Course not found', 404);
  sendSuccess(res, result);
});

const getSessionsInternal = asyncHandler(async (req, res) => {
  const result = await coursesService.getSessionsByCourseIdInternal(req.params.id);
  if (result === null) throw new AppError('Course not found', 404);
  sendSuccess(res, result);
});

const listBatchesAdmin = asyncHandler(async (req, res) => {
  const result = await coursesService.listBatchesAdminPaginated({
    courseId: req.query.course_id,
    page: req.query.page,
    limit: req.query.limit,
  });
  sendPaginated(res, result);
});

const getBatchByIdInternal = asyncHandler(async (req, res) => {
  const batch = await coursesService.getBatchByIdInternal(req.params.id);
  if (!batch) throw new AppError('Batch not found', 404);
  sendSuccess(res, batch);
});

const getMaterials = asyncHandler(async (req, res) => {
  const rows = await coursesService.getMaterialsByCourseId(req.params.id, {
    authorization: req.headers.authorization,
  });
  if (rows === null) throw new AppError('Course not found', 404);
  sendSuccess(res, rows);
});

const createCourse = asyncHandler(async (req, res) => {
  const course = await coursesService.create(req.body);
  sendCreated(res, course);
});

const updateCourse = asyncHandler(async (req, res) => {
  const course = await coursesService.update(req.params.id, req.body);
  if (!course) throw new AppError('Course not found', 404);
  sendSuccess(res, course);
});

const createBatch = asyncHandler(async (req, res) => {
  const batch = await coursesService.createBatchFromCurriculum(req.params.id, req.body);
  if (!batch) throw new AppError('Course not found', 404);
  sendCreated(res, batch);
});

const updateBatch = asyncHandler(async (req, res) => {
  const batch = await coursesService.updateBatch(req.params.id, req.body);
  if (!batch) throw new AppError('Batch not found', 404);
  sendSuccess(res, batch);
});

const syncBatch = asyncHandler(async (req, res) => {
  const result = await coursesService.syncBatchSessions(req.params.id);
  if (!result) throw new AppError('Batch not found', 404);
  sendSuccess(res, result);
});

const createSession = asyncHandler(async (req, res) => {
  const session = await coursesService.createSession(req.params.id, req.body);
  sendCreated(res, session);
});

const updateSession = asyncHandler(async (req, res) => {
  const session = await coursesService.updateSession(req.params.id, req.body);
  if (!session) throw new AppError('Session not found', 404);
  sendSuccess(res, session);
});

const addRecording = asyncHandler(async (req, res) => {
  const recording = await coursesService.addRecording(req.params.id, req.body);
  sendCreated(res, recording);
});

const updateRecording = asyncHandler(async (req, res) => {
  const recording = await coursesService.updateRecording(req.params.id, req.body);
  if (!recording) throw new AppError('Recording not found', 404);
  sendSuccess(res, recording);
});

const addMaterial = asyncHandler(async (req, res) => {
  const material = await coursesService.addMaterial(req.params.id, req.body);
  sendCreated(res, material);
});

const listAllInternal = asyncHandler(async (req, res) => {
  const rows = await coursesService.listAll({ trashed: req.query.trashed });
  sendSuccess(res, rows);
});

const deleteCourseInternal = asyncHandler(async (req, res) => {
  const ok = await coursesService.deleteCourse(req.params.id);
  if (!ok) throw new AppError('Course not found', 404);
  sendNoContent(res);
});

const restoreCourseInternal = asyncHandler(async (req, res) => {
  const ok = await coursesService.restoreCourse(req.params.id);
  if (!ok) throw new AppError('Course not found in trash', 404);
  sendNoContent(res);
});

const deleteCoursePermanentlyInternal = asyncHandler(async (req, res) => {
  const result = await coursesService.deleteCoursePermanently(req.params.id);
  if (!result.ok) {
    if (result.reason === 'not_trashed') {
      throw new AppError('Course must be in trash before it can be permanently deleted', 409);
    }
    throw new AppError('Course not found in trash', 404);
  }
  sendNoContent(res);
});

const listByIdsOrCatIds = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const cat_ids = Array.isArray(req.body.cat_ids) ? req.body.cat_ids : [];
  const order = req.body.order === 'DESC' ? 'DESC' : 'ASC';
  const includeUnpublished = req.body.includeUnpublished === true || req.body.includeUnpublished === 'true';
  const rows = await coursesService.listByIdsOrCatIds({ ids, cat_ids, order, includeUnpublished });
  sendSuccess(res, rows);
});

const listCourseCatsPublic = asyncHandler(async (req, res) => {
  const rows = await coursesService.listCourseCatsPublic();
  sendSuccess(res, rows);
});

const listCourseCatsAllPublic = asyncHandler(async (req, res) => {
  const rows = await coursesService.listCourseCats();
  sendSuccess(res, rows);
});

const listCourseCatsInternal = asyncHandler(async (req, res) => {
  const rows = await coursesService.listCourseCats();
  sendSuccess(res, rows);
});

const createCourseCat = asyncHandler(async (req, res) => {
  const row = await coursesService.createCourseCat(req.body);
  sendCreated(res, row);
});

const updateCourseCat = asyncHandler(async (req, res) => {
  const row = await coursesService.updateCourseCat(req.params.id, req.body);
  if (!row) throw new AppError('Course category not found', 404);
  sendSuccess(res, row);
});

const deleteCourseCat = asyncHandler(async (req, res) => {
  const ok = await coursesService.deleteCourseCat(req.params.id);
  if (!ok) throw new AppError('Course category not found', 404);
  sendSuccess(res, { deleted: true });
});

const listByCategory = asyncHandler(async (req, res) => {
  const { category, search = '', sort = 'latest', price = 'all' } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 9), 24);
  const result = await coursesService.listPublishedByCategory(category, { page, limit, search, sort, price });
  sendSuccess(res, result);
});

const getByIdInternal = asyncHandler(async (req, res) => {
  const course = await coursesService.getByIdInternal(req.params.id);
  if (!course) throw new AppError('Course not found', 404);
  sendSuccess(res, course);
});

const getPageSettings = asyncHandler(async (req, res) => {
  const settings = await coursesService.getAllPageSettings();
  sendSuccess(res, settings);
});

const updatePageSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;
  if (!key) throw new AppError('Setting key is required', 400);
  const result = await coursesService.upsertPageSetting(key, value);
  sendSuccess(res, result);
});

const toggleRecordingVisibility = asyncHandler(async (req, res) => {
  const { is_visible } = req.body;
  const recording = await coursesService.toggleRecordingVisibility(req.params.id, is_visible);
  if (!recording) throw new AppError('Recording not found', 404);
  sendSuccess(res, recording);
});

const deleteRecording = asyncHandler(async (req, res) => {
  const ok = await coursesService.deleteRecording(req.params.id);
  if (!ok) throw new AppError('Recording not found', 404);
  sendSuccess(res, { deleted: true });
});

const deleteSession = asyncHandler(async (req, res) => {
  const ok = await coursesService.deleteSession(req.params.id);
  if (!ok) throw new AppError('Session not found', 404);
  sendSuccess(res, { deleted: true });
});

const deleteBatch = asyncHandler(async (req, res) => {
  const ok = await coursesService.deleteBatch(req.params.id);
  if (!ok) throw new AppError('Batch not found', 404);
  sendSuccess(res, { deleted: true });
});

const getBatchEnrollments = asyncHandler(async (req, res) => {
  const rows = await coursesService.getBatchEnrollments(req.params.id);
  sendSuccess(res, rows);
});

const addBatchEnrollment = asyncHandler(async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) throw new AppError('user_id is required', 400);
  const result = await coursesService.addBatchEnrollment(req.params.id, user_id);
  sendCreated(res, result);
});

const autoEnrollBatch = asyncHandler(async (req, res) => {
  const { user_id, batch_id } = req.body;
  if (!user_id) throw new AppError('user_id is required', 400);
  const result = await coursesService.autoEnrollInBatch(
    req.params.id,
    user_id,
    batch_id || null
  );
  sendSuccess(res, result || { message: 'No active batch found' });
});

// Atomically set the user's single batch for this course (removes any other batch of the same
// course, then ensures the target enrollment). Used by admin user-edit to switch batches without
// leaving the user enrolled in two batches at once.
const setUserCourseBatch = asyncHandler(async (req, res) => {
  const { user_id, batch_id } = req.body;
  if (!user_id) throw new AppError('user_id is required', 400);
  if (!batch_id) throw new AppError('batch_id is required', 400);
  const result = await coursesService.setUserCourseBatch(user_id, req.params.id, batch_id);
  sendSuccess(res, result);
});

const selectPurchaseBatch = asyncHandler(async (req, res) => {
  const batch = await coursesService.selectPurchaseBatch(req.params.id);
  if (!batch) return sendSuccess(res, null);
  sendSuccess(res, {
    id: batch.id,
    course_id: batch.course_id,
    name: batch.name,
    start_date: batch.start_date,
    end_date: batch.end_date,
  });
});

const removeBatchEnrollment = asyncHandler(async (req, res) => {
  const ok = await coursesService.removeBatchEnrollment(req.params.id);
  if (!ok) throw new AppError('Enrollment not found', 404);
  sendSuccess(res, { deleted: true });
});

const getUserEnrollments = asyncHandler(async (req, res) => {
  const userId = parseInt(req.params.userId, 10);
  if (!userId) throw new AppError('Invalid user id', 400);
  const rows = await coursesService.getEnrollmentsByUser(userId);
  sendSuccess(res, rows);
});

const listBatchesByCourse = asyncHandler(async (req, res) => {
  const rows = await coursesService.listBatchesByCourse(req.params.id);
  sendSuccess(res, rows);
});

const listAllBatches = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 100), 500);
  const courseId = req.query.course_id ? parseInt(req.query.course_id, 10) : undefined;
  const result = await coursesService.listAllBatches({ courseId, page, limit });
  sendSuccess(res, result);
});

const unenrollUser = asyncHandler(async (req, res) => {
  const { user_id } = req.body;
  const course_id = req.params.id;
  if (!user_id || !course_id) throw new AppError('user_id and course_id are required', 400);
  await coursesService.unenrollUser(user_id, course_id);
  sendSuccess(res, { unenrolled: true });
});

const createPreviewToken = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  if (!Number.isFinite(courseId) || courseId <= 0) throw new AppError('Invalid course id', 400);
  const token = await previewTokenService.createPreviewToken(courseId);
  sendSuccess(res, { token, expiresInSeconds: 900 });
});

const resolvePreviewToken = asyncHandler(async (req, res) => {
  const courseId = await previewTokenService.resolvePreviewToken(req.params.token);
  if (!courseId) throw new AppError('Invalid or expired preview token', 404);
  sendSuccess(res, { courseId });
});

module.exports = {
  list,
  listFeatured,
  listByCategory,
  listCourseCatsPublic,
  listCourseCatsAllPublic,
  getById,
  getBySlug,
  getSessions,
  getSessionsBySlug,
  getSessionsInternal,
  listBatchesAdmin,
  getBatchByIdInternal,
  getMaterials,
  createCourse,
  updateCourse,
  createBatch,
  updateBatch,
  syncBatch,
  createSession,
  updateSession,
  addRecording,
  updateRecording,
  toggleRecordingVisibility,
  deleteRecording,
  deleteSession,
  deleteBatch,
  getBatchEnrollments,
  addBatchEnrollment,
  removeBatchEnrollment,
  autoEnrollBatch,
  setUserCourseBatch,
  unenrollUser,
  getUserEnrollments,
  listBatchesByCourse,
  listAllBatches,
  selectPurchaseBatch,
  addMaterial,
  listAllInternal,
  deleteCourseInternal,
  restoreCourseInternal,
  deleteCoursePermanentlyInternal,
  listCourseCatsInternal,
  createCourseCat,
  updateCourseCat,
  deleteCourseCat,
  getByIdInternal,
  getPageSettings,
  updatePageSetting,
  listByIdsOrCatIds,
  createPreviewToken,
  resolvePreviewToken,
};
