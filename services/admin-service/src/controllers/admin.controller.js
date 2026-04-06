const FormData = require('form-data');
const courseClient = require('../clients/courseClient');
const orderClient = require('../clients/orderClient');
const platformClient = require('../clients/platformClient');
const adminLogsService = require('../services/adminLogs.service');
const paymentConfigService = require('../services/paymentConfig.service');
const { PromoCode } = require('../models');
const { getAdminId, getAdminRole } = require('../middleware');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent, sendPaginated } = require('../../../../shared');

const me = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  if (!adminId) throw new AppError('Unauthorized', 401);
  sendSuccess(res, { adminId, role: getAdminRole(req) });
});

const getPaymentConfigInternal = asyncHandler(async (req, res) => {
  const data = await paymentConfigService.getPaymentConfig();
  sendSuccess(res, data);
});

const getStats = asyncHandler(async (req, res) => {
  const data = await adminLogsService.getStats();
  sendSuccess(res, data);
});

const updatePaymentConfig = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { razorpay_key_id, razorpay_key_secret } = req.body;
  const result = await paymentConfigService.updatePaymentConfig({ razorpay_key_id, razorpay_key_secret });
  await adminLogsService.logAction(adminId, 'UPDATE_PAYMENT_CONFIG', 'payment_config', '1', {}, req.ip);
  sendSuccess(res, result);
});

const getLogs = asyncHandler(async (req, res) => {
  const rows = await adminLogsService.getLogs(100);
  sendSuccess(res, rows);
});

// ── Course proxy handlers ──────────────────────────────────────────

const createCourse = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post('/internal/courses', req.body);
  await adminLogsService.logAction(adminId, 'CREATE_COURSE', 'course', String(data.id), { title: data.title }, req.ip);
  sendCreated(res, data);
});

const updateCourse = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/courses/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_COURSE', 'course', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const createBatch = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post(`/internal/courses/${req.params.id}/batches`, req.body);
  await adminLogsService.logAction(adminId, 'CREATE_BATCH', 'batch', String(data.id), { courseId: req.params.id }, req.ip);
  sendCreated(res, data);
});

const updateBatch = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/batches/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_BATCH', 'batch', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const createSession = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post(`/internal/batches/${req.params.id}/sessions`, req.body);
  await adminLogsService.logAction(adminId, 'CREATE_SESSION', 'session', String(data.id), { batchId: req.params.id }, req.ip);
  sendCreated(res, data);
});

const updateSession = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/sessions/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_SESSION', 'session', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const addRecording = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post(`/internal/sessions/${req.params.id}/recordings`, req.body);
  await adminLogsService.logAction(adminId, 'ADD_RECORDING', 'recording', String(data.id), { sessionId: req.params.id }, req.ip);
  sendCreated(res, data);
});

const addMaterial = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post(`/internal/courses/${req.params.id}/materials`, req.body);
  await adminLogsService.logAction(adminId, 'ADD_MATERIAL', 'material', String(data.id), { courseId: req.params.id }, req.ip);
  sendCreated(res, data);
});

const getCourses = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/courses');
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const getCourse = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/courses/${req.params.id}`);
  sendSuccess(res, data);
});

const getCourseSessions = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/courses/${req.params.id}/sessions`);
  sendSuccess(res, data);
});

const updateRecording = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/recordings/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_RECORDING', 'recording', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const toggleRecordingVisibility = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/recordings/${req.params.id}/visibility`, req.body);
  await adminLogsService.logAction(adminId, 'TOGGLE_RECORDING_VISIBILITY', 'recording', req.params.id, { is_visible: req.body.is_visible }, req.ip);
  sendSuccess(res, data);
});

const deleteRecording = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.delete(`/internal/recordings/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_RECORDING', 'recording', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const deleteSession = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.delete(`/internal/sessions/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_SESSION', 'session', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const deleteBatch = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.delete(`/internal/batches/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_BATCH', 'batch', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const getBatchEnrollments = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/batches/${req.params.id}/enrollments`);
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const addBatchEnrollment = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post(`/internal/batches/${req.params.id}/enrollments`, req.body);
  await adminLogsService.logAction(adminId, 'ADD_BATCH_ENROLLMENT', 'batch_enrollment', String(data.id), { batchId: req.params.id, userId: req.body.user_id }, req.ip);
  sendCreated(res, data);
});

const removeBatchEnrollment = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.delete(`/internal/batch-enrollments/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'REMOVE_BATCH_ENROLLMENT', 'batch_enrollment', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const getCourseCats = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/course-cats');
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const createCourseCat = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post('/internal/course-cats', req.body);
  await adminLogsService.logAction(adminId, 'CREATE_COURSE_CAT', 'course_cat', data?.id, req.body, req.ip);
  res.status(201).json(data);
});

const updateCourseCat = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/course-cats/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_COURSE_CAT', 'course_cat', req.params.id, req.body, req.ip);
  sendSuccess(res, data);
});

const deleteCourseCat = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.delete(`/internal/course-cats/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_COURSE_CAT', 'course_cat', req.params.id, {}, req.ip);
  sendSuccess(res, { deleted: true });
});

const getCoursePageSettings = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/course-page-settings');
  sendSuccess(res, data);
});

const updateCoursePageSetting = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/course-page-settings/${req.params.key}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_COURSE_PAGE_SETTING', 'course_page_setting', req.params.key, {}, req.ip);
  sendSuccess(res, data);
});

const getOrders = asyncHandler(async (req, res) => {
  const limit = req.query.limit || 100;
  const offset = req.query.offset || 0;
  const { data } = await orderClient.get('/internal/orders', { params: { limit, offset } });
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const getOrderByOrderId = asyncHandler(async (req, res) => {
  const { data } = await orderClient.get(`/internal/orders/${encodeURIComponent(req.params.orderId)}`);
  sendSuccess(res, data);
});

// ── Platform proxy handlers ────────────────────────────────────────

function platformProxy(handler) {
  return asyncHandler(async (req, res) => {
    const result = await handler(platformClient, req);
    if (result.status === 204) return sendNoContent(res);
    if (result.status === 201) return sendCreated(res, result.data);
    if (result.data && typeof result.data === 'object' && 'meta' in result.data) {
      return sendPaginated(res, result.data);
    }
    sendSuccess(res, result.data);
  });
}

const getPromoCodes = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.active !== undefined) {
    where.active = req.query.active === '1' || req.query.active === 'true';
  }
  const rows = await PromoCode.findAll({ where, order: [['created_at', 'DESC']] });
  sendSuccess(res, rows.map((row) => row.get({ plain: true })));
});

const getPromoCode = asyncHandler(async (req, res) => {
  const promo = await PromoCode.findByPk(req.params.id);
  if (!promo) throw new AppError('Promo code not found', 404);
  sendSuccess(res, promo.get({ plain: true }));
});

const postPromoCode = asyncHandler(async (req, res) => {
  const promo = await PromoCode.create(req.body);
  sendCreated(res, promo.get({ plain: true }));
});

const putPromoCode = asyncHandler(async (req, res) => {
  const promo = await PromoCode.findByPk(req.params.id);
  if (!promo) throw new AppError('Promo code not found', 404);
  await promo.update(req.body);
  sendSuccess(res, promo.get({ plain: true }));
});

const deletePromoCode = asyncHandler(async (req, res) => {
  const promo = await PromoCode.findByPk(req.params.id);
  if (!promo) throw new AppError('Promo code not found', 404);
  await promo.destroy();
  sendNoContent(res);
});

const platform = {
  getHome: platformProxy((c) => c.get('/internal/platform/home').then((r) => ({ data: r.data }))),
  putHome: platformProxy((c, req) => c.put('/internal/platform/home', req.body).then((r) => ({ data: r.data }))),
  getStates: platformProxy((c) => c.get('/internal/platform/states').then((r) => ({ data: r.data }))),
  postState: platformProxy((c, req) => c.post('/internal/platform/states', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putState: platformProxy((c, req) => c.put(`/internal/platform/states/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  getTestimonials: platformProxy((c) => c.get('/internal/platform/testimonials').then((r) => ({ data: r.data }))),
  postTestimonial: platformProxy((c, req) => c.post('/internal/platform/testimonials', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putTestimonial: platformProxy((c, req) => c.put(`/internal/platform/testimonials/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteTestimonial: platformProxy((c, req) => c.delete(`/internal/platform/testimonials/${req.params.id}`).then(() => ({ status: 204 }))),
  getFaqs: platformProxy((c) => c.get('/internal/platform/faqs').then((r) => ({ data: r.data }))),
  getFaq: platformProxy((c, req) => c.get(`/internal/platform/faqs/${req.params.id}`).then((r) => ({ data: r.data }))),
  postFaq: platformProxy((c, req) => c.post('/internal/platform/faqs', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putFaq: platformProxy((c, req) => c.put(`/internal/platform/faqs/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteFaq: platformProxy((c, req) => c.delete(`/internal/platform/faqs/${req.params.id}`).then(() => ({ status: 204 }))),
  getSeoMetadata: platformProxy((c) => c.get('/internal/platform/seo-metadata').then((r) => ({ data: r.data }))),
  getSeoMetadataById: platformProxy((c, req) => c.get(`/internal/platform/seo-metadata/${req.params.id}`).then((r) => ({ data: r.data }))),
  getSeoMetadataBySlug: platformProxy((c, req) => c.get(`/internal/platform/seo-metadata/slug/${req.params.slug}`).then((r) => ({ data: r.data }))),
  postSeoMetadata: platformProxy((c, req) => c.post('/internal/platform/seo-metadata', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putSeoMetadata: platformProxy((c, req) => c.put(`/internal/platform/seo-metadata/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteSeoMetadata: platformProxy((c, req) => c.delete(`/internal/platform/seo-metadata/${req.params.id}`).then(() => ({ status: 204 }))),
  getFooter: platformProxy((c) => c.get('/internal/platform/footer').then((r) => ({ data: r.data }))),
  putFooter: platformProxy((c, req) => c.put(`/internal/platform/footer/${req.params.key}`, req.body).then((r) => ({ data: r.data }))),
  getPlans: platformProxy((c) => c.get('/internal/platform/plans').then((r) => ({ data: r.data }))),
  getPlan: platformProxy((c, req) => c.get(`/internal/platform/plans/${req.params.id}`).then((r) => ({ data: r.data }))),
  postPlan: platformProxy((c, req) => c.post('/internal/platform/plans', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putPlan: platformProxy((c, req) => c.put(`/internal/platform/plans/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  togglePlanPopular: platformProxy((c, req) => c.put(`/internal/platform/plans/${req.params.id}/popular`, req.body).then((r) => ({ data: r.data }))),
  deletePlan: platformProxy((c, req) => c.delete(`/internal/platform/plans/${req.params.id}`).then(() => ({ status: 204 }))),

  getPromoCodes,
  getPromoCode,
  postPromoCode,
  putPromoCode,
  deletePromoCode,
  getArticles: platformProxy((c, req) => c.get('/internal/platform/articles', { params: req.query }).then((r) => ({ data: r.data }))),
  getArticle: platformProxy((c, req) => c.get(`/internal/platform/articles/${req.params.id}`).then((r) => ({ data: r.data }))),
  postArticle: platformProxy((c, req) => c.post('/internal/platform/articles', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putArticle: platformProxy((c, req) => c.put(`/internal/platform/articles/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteArticle: platformProxy((c, req) => c.delete(`/internal/platform/articles/${req.params.id}`).then(() => ({ status: 204 }))),
  getArticleCategories: platformProxy((c) => c.get('/internal/platform/article-categories').then((r) => ({ data: r.data }))),
  getArticleCategory: platformProxy((c, req) => c.get(`/internal/platform/article-categories/${req.params.id}`).then((r) => ({ data: r.data }))),
  createArticleCategory: platformProxy((c, req) => c.post('/internal/platform/article-categories', req.body).then((r) => ({ data: r.data, status: 201 }))),
  updateArticleCategory: platformProxy((c, req) => c.put(`/internal/platform/article-categories/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteArticleCategory: platformProxy((c, req) => c.delete(`/internal/platform/article-categories/${req.params.id}`).then(() => ({ status: 204 }))),
  getTags: platformProxy((c) => c.get('/internal/platform/tags').then((r) => ({ data: r.data }))),
  getArticleTypes: platformProxy((c) => c.get('/internal/platform/article-types').then((r) => ({ data: r.data }))),
  getCourts: platformProxy((c) => c.get('/internal/platform/courts').then((r) => ({ data: r.data }))),
  getCmsPages: platformProxy((c) => c.get('/internal/platform/cms-pages').then((r) => ({ data: r.data }))),
  getCmsPageBySlug: platformProxy((c, req) => c.get(`/internal/platform/cms-pages/${req.params.slug}`).then((r) => ({ data: r.data }))),
  putCmsPage: platformProxy((c, req) => c.put(`/internal/platform/cms-pages/${req.params.slug}`, req.body).then((r) => ({ data: r.data }))),
  getMediaAssets: platformProxy((c, req) => c.get('/internal/platform/media-assets', { params: req.query }).then((r) => ({ data: r.data }))),
  postMediaAsset: platformProxy((c, req) => c.post('/internal/platform/media-assets', req.body).then((r) => ({ data: r.data, status: 201 }))),
  deleteMediaAsset: platformProxy((c, req) => c.delete(`/internal/platform/media-assets/${req.params.id}`).then(() => ({ status: 204 }))),
};

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) throw new AppError('No file uploaded', 400);
  const form = new FormData();
  form.append('file', req.file.buffer, { filename: req.file.originalname || 'image.jpg' });
  const { data } = await platformClient.post('/internal/platform/upload/image', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  // platform-service wraps its response in { success, data }; unwrap before re-wrapping
  const payload = data?.success === true && data?.data !== undefined ? data.data : data;
  sendSuccess(res, payload);
});

module.exports = {
  me,
  getPaymentConfigInternal,
  getStats,
  updatePaymentConfig,
  getLogs,
  createCourse,
  updateCourse,
  createBatch,
  updateBatch,
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
  addMaterial,
  getCourses,
  getCourse,
  getCourseSessions,
  getCourseCats,
  createCourseCat,
  updateCourseCat,
  deleteCourseCat,
  getCoursePageSettings,
  updateCoursePageSetting,
  getOrders,
  getOrderByOrderId,
  platform,
  uploadImage,
};
