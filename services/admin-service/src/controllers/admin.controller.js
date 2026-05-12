const FormData = require('form-data');
const courseClient = require('../clients/courseClient');
const orderClient = require('../clients/orderClient');
const platformClient = require('../clients/platformClient');
const authClient = require('../clients/authClient');
const adminLogsService = require('../services/adminLogs.service');
const paymentConfigService = require('../services/paymentConfig.service');
const paymentLinkService = require('../services/paymentLink.service');
const { sequelize, Coupon } = require('../models');
const { Op } = require('sequelize');

/** Normalizes and validates coupon body for create/update. */
function validateCouponPayload(body) {
  const type = String(body.type || '').trim();
  if (type !== 'Percentage' && type !== 'Amount') {
    throw new AppError('Invalid coupon type', 400);
  }
  const value = Number(body.value);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError('Discount value must be a positive number', 400);
  }
  if (type === 'Percentage' && value > 100) {
    throw new AppError('Percentage discount cannot exceed 100', 400);
  }
  let max_discount = body.max_discount;
  if (type === 'Amount') {
    max_discount = null;
  } else if (max_discount != null && max_discount !== '') {
    const m = Number(max_discount);
    if (!Number.isFinite(m) || m < 0) throw new AppError('Invalid maximum discount', 400);
    max_discount = m;
  } else {
    max_discount = null;
  }
  if (body.min_order != null && body.min_order !== '') {
    const mo = Number(body.min_order);
    if (!Number.isFinite(mo) || mo < 0) throw new AppError('Invalid minimum order value', 400);
  }
  const start = body.start_date ? new Date(body.start_date) : null;
  const end = body.expire_date ? new Date(body.expire_date) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
    throw new AppError('Expiry date must be after start date', 400);
  }
  const code = body.code != null ? String(body.code).trim().toUpperCase() : '';
  if (!code) throw new AppError('Coupon code is required', 400);
  return {
    code,
    description: body.description != null ? body.description : null,
    type,
    value,
    max_discount,
    min_order: body.min_order != null && body.min_order !== '' ? Number(body.min_order) : null,
    discount_on: body.discount_on,
    start_date: body.start_date || null,
    expire_date: body.expire_date || null,
    status: body.status || 'publish',
  };
}
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

const syncBatch = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post(`/internal/batches/${req.params.id}/sync`);
  await adminLogsService.logAction(adminId, 'SYNC_BATCH', 'batch', req.params.id, {}, req.ip);
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

const listBatches = asyncHandler(async (req, res) => {
  const payload = (
    await courseClient.get('/internal/batches', {
      params: {
        course_id: req.query.course_id,
        page: req.query.page,
        limit: req.query.limit,
      },
    })
  ).data;
  sendPaginated(res, {
    data: payload.data,
    meta: {
      total: payload.total,
      page: payload.page,
      limit: payload.limit,
      totalPages: payload.totalPages,
      hasNextPage: payload.hasNextPage,
      hasPreviousPage: payload.hasPreviousPage,
    },
  });
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

/** Same rules as study-cafe-web `isUserCourseOrderPurchase` — order-service also returns membership rows as synthetic "course" purchases. */
function isUserCourseOrderPurchase(p) {
  const cat = p.course?.category;
  if (cat === 'membership') return false;
  if (p.course?.title === 'Membership') return false;
  return true;
}

const getUserEnrollments = asyncHandler(async (req, res) => {
  const userId = req.params.id;

  // Internal purchases = same payload as GET /orders/my-purchases (paid orders only).
  let purchases = [];
  try {
    const { data: resData } = await orderClient.get(`/internal/users/${userId}/purchases`);
    purchases = Array.isArray(resData) ? resData : (resData?.data || []);
  } catch (err) {
    logger.warn(`Failed to fetch purchases from order-service for user ${userId}: ${err.message}`);
  }

  // Enrich from course-service (batch titles, enrollment ids). Course rows may still exist after refund if cleanup lagged — do not use this list alone.
  let enrollments = [];
  try {
    const { data: resData } = await courseClient.get(`/internal/users/${userId}/enrollments`);
    enrollments = Array.isArray(resData) ? resData : (resData?.data || []);
  } catch (err) {
    logger.warn(`Failed to fetch enrollments from course-service for user ${userId}: ${err.message}`);
  }

  const enrollmentByCourseId = new Map();
  for (const e of enrollments) {
    if (e && e.course_id != null) {
      enrollmentByCourseId.set(String(e.course_id), e);
    }
  }

  // Authoritative course list = paid course purchases only (matches user "My Purchases" / my-purchases).
  const resultsMap = new Map();
  for (const p of purchases) {
    if (!p.course || p.courseId == null) continue;
    if (!isUserCourseOrderPurchase(p)) continue;

    const cid = String(p.courseId);
    if (resultsMap.has(cid)) continue;

    const e = enrollmentByCourseId.get(cid);
    resultsMap.set(cid, {
      enrollment_id: e?.enrollment_id ?? null,
      course_id: Number(cid),
      course_title: e?.course_title ?? p.course?.title ?? 'Unknown Course',
      batch_id: e?.batch_id ?? p.batchId ?? null,
      batch_name: e?.batch_name ?? p.enrolledBatch?.name ?? null,
      enrolled_at: e?.enrolled_at ?? p.purchaseDate ?? null,
      order_id: p.id != null ? String(p.id) : null,
      purchase_status: p.status ?? null,
      from_purchase: true,
    });
  }

  sendSuccess(res, Array.from(resultsMap.values()).sort((a, b) => {
    const dateA = a.enrolled_at ? new Date(a.enrolled_at).getTime() : 0;
    const dateB = b.enrolled_at ? new Date(b.enrolled_at).getTime() : 0;
    return dateB - dateA;
  }));
});

const getUserMemberships = asyncHandler(async (req, res) => {
  const { data } = await authClient.get(`/internal/users/${req.params.id}/memberships`);
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const getBatches = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/batches', { params: req.query });
  sendSuccess(res, data);
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
  const { data } = await orderClient.get('/internal/orders', { params: req.query });

  if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
    return sendPaginated(res, data);
  }

  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const getOrderByOrderId = asyncHandler(async (req, res) => {
  const { data } = await orderClient.get(`/internal/orders/${encodeURIComponent(req.params.orderId)}`);
  sendSuccess(res, data);
});

const createOrder = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await orderClient.post('/internal/orders', req.body);
  await adminLogsService.logAction(adminId, 'CREATE_ORDER', 'order', String(data.id), { orderId: data.order_id }, req.ip);
  sendCreated(res, data);
});

const applyCouponAdmin = asyncHandler(async (req, res) => {
  const { data } = await orderClient.post('/order/apply-coupon', req.body);
  sendSuccess(res, data);
});

const updateOrder = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await orderClient.put(`/internal/orders/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_ORDER', 'order', req.params.id, { status: req.body.status }, req.ip);
  sendSuccess(res, data);
});

const deleteOrder = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await orderClient.delete(`/internal/orders/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_ORDER', 'order', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const refundOrder = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await orderClient.post(`/internal/orders/${req.params.id}/refund`, req.body);
  await adminLogsService.logAction(adminId, 'REFUND_ORDER', 'order', req.params.id, { amount: req.body.amount }, req.ip);
  sendSuccess(res, data);
});

// ── Platform proxy handlers ────────────────────────────────────────

function platformProxy(handler) {
  return asyncHandler(async (req, res) => {
    const result = await handler(platformClient, req);
    if (result.status === 204) return sendNoContent(res);
    if (result.status === 201) return sendCreated(res, result.data);
    // True paginated shape: { data, meta } (e.g. list + pagination).
    // CMS page rows are { id, slug, title, content, meta } — a JSON `meta` field must NOT
    // trigger this branch or the record is mangled and the admin form loads empty.
    const d = result.data;
    if (d && typeof d === 'object' && 'data' in d && 'meta' in d) {
      return sendPaginated(res, d);
    }
    sendSuccess(res, result.data);
  });
}

const getCoupons = asyncHandler(async (req, res) => {
  const where = {};
  if (req.query.status !== undefined) {
    where.status = req.query.status;
  }
  const rows = await Coupon.findAll({ where, order: [['created_at', 'DESC']] });
  sendSuccess(res, rows.map((row) => row.get({ plain: true })));
});

const getCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (!coupon) throw new AppError('Coupon not found', 404);
  sendSuccess(res, coupon.get({ plain: true }));
});

const postCoupon = asyncHandler(async (req, res) => {
  const payload = validateCouponPayload(req.body);
  const coupon = await Coupon.create(payload);
  sendCreated(res, coupon.get({ plain: true }));
});

const putCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (!coupon) throw new AppError('Coupon not found', 404);
  const merged = { ...coupon.get({ plain: true }), ...req.body };
  const payload = validateCouponPayload(merged);
  await coupon.update(payload);
  await coupon.reload();
  sendSuccess(res, coupon.get({ plain: true }));
});

const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findByPk(req.params.id);
  if (!coupon) throw new AppError('Coupon not found', 404);
  await coupon.destroy();
  sendNoContent(res);
});

const checkCouponCodeExists = asyncHandler(async (req, res) => {
  const { code, excludeId } = req.query;
  if (!code || !String(code).trim()) {
    return sendSuccess(res, { exists: false });
  }

  const normalized = String(code).trim().toLowerCase();
  const clauses = [sequelize.where(sequelize.fn('lower', sequelize.col('code')), normalized)];
  if (excludeId) clauses.push({ id: { [Op.ne]: excludeId } });
  const existingCoupon = await Coupon.findOne({ where: { [Op.and]: clauses } });
  sendSuccess(res, { exists: !!existingCoupon });
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
  getSeoEligiblePages: platformProxy((c) => c.get('/internal/platform/seo-metadata/eligible-pages').then((r) => ({ data: r.data }))),
  getSeoMetadataById: platformProxy((c, req) => c.get(`/internal/platform/seo-metadata/${req.params.id}`).then((r) => ({ data: r.data }))),
  getSeoMetadataBySlug: platformProxy((c, req) => c.get(`/internal/platform/seo-metadata/slug/${req.params.slug}`).then((r) => ({ data: r.data }))),
  postSeoMetadata: platformProxy((c, req) => c.post('/internal/platform/seo-metadata', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putSeoMetadata: platformProxy((c, req) => c.put(`/internal/platform/seo-metadata/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteSeoMetadata: platformProxy((c, req) => c.delete(`/internal/platform/seo-metadata/${req.params.id}`).then(() => ({ status: 204 }))),
  listSiteSeoRoutes: platformProxy((c) => c.get('/internal/platform/site-seo-routes').then((r) => ({ data: r.data }))),
  postSiteSeoRoute: platformProxy((c, req) =>
    c.post('/internal/platform/site-seo-routes', req.body).then((r) => ({ data: r.data, status: 201 }))
  ),
  putSiteSeoRoute: platformProxy((c, req) =>
    c.put(`/internal/platform/site-seo-routes/${req.params.id}`, req.body).then((r) => ({ data: r.data }))
  ),
  deleteSiteSeoRoute: platformProxy((c, req) =>
    c.delete(`/internal/platform/site-seo-routes/${req.params.id}`).then(() => ({ status: 204 }))
  ),
  getFooter: platformProxy((c) => c.get('/internal/platform/footer').then((r) => ({ data: r.data }))),
  putFooter: platformProxy((c, req) => c.put(`/internal/platform/footer/${req.params.key}`, req.body).then((r) => ({ data: r.data }))),
  getSiteAds: platformProxy((c) => c.get('/internal/platform/site-ads').then((r) => ({ data: r.data }))),
  putSiteAds: platformProxy((c, req) => c.put('/internal/platform/site-ads', req.body).then((r) => ({ data: r.data }))),
  getGlobalSettings: platformProxy((c) =>
    c.get('/internal/platform/global-settings').then((r) => ({ data: r.data }))
  ),
  putGlobalSetting: platformProxy((c, req) =>
    c.put(`/internal/platform/global-settings/${encodeURIComponent(req.params.key)}`, req.body).then((r) => ({ data: r.data }))
  ),
  getPlans: platformProxy((c) => c.get('/internal/platform/plans').then((r) => ({ data: r.data }))),
  getPlan: platformProxy((c, req) => c.get(`/internal/platform/plans/${req.params.id}`).then((r) => ({ data: r.data }))),
  postPlan: platformProxy((c, req) => c.post('/internal/platform/plans', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putPlan: platformProxy((c, req) => c.put(`/internal/platform/plans/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  togglePlanPopular: platformProxy((c, req) => c.put(`/internal/platform/plans/${req.params.id}/popular`, req.body).then((r) => ({ data: r.data }))),
  deletePlan: platformProxy((c, req) => c.delete(`/internal/platform/plans/${req.params.id}`).then(() => ({ status: 204 }))),
  getComparisonFeatures: platformProxy((c) => c.get('/internal/platform/comparison-features').then((r) => ({ data: r.data }))),
  postComparisonFeature: platformProxy((c, req) => c.post('/internal/platform/comparison-features', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putComparisonFeature: platformProxy((c, req) => c.put(`/internal/platform/comparison-features/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteComparisonFeature: platformProxy((c, req) => c.delete(`/internal/platform/comparison-features/${req.params.id}`).then(() => ({ status: 204 }))),
  setFeatureAvailability: platformProxy((c, req) => c.put(`/internal/platform/comparison-features/${req.params.featureId}/availability/${req.params.planId}`, req.body).then((r) => ({ data: r.data }))),
  contactInquiries: platformProxy((c) => c.get('/internal/platform/contact-inquiries').then((r) => ({ data: r.data }))),

  getCoupons,
  getCoupon,
  postCoupon,
  putCoupon,
  deleteCoupon,
  checkCouponCodeExists,
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

  // ── Newsletter ────────────────────────────────────────────────────
  getNewsletterSubscribers: platformProxy((c) => c.get('/internal/platform/newsletter/subscribers').then((r) => ({ data: r.data }))),
  deleteNewsletterSubscriber: platformProxy((c, req) => c.delete(`/internal/platform/newsletter/subscribers/${req.params.id}`).then(() => ({ status: 204 }))),
  getNewsletterTemplates: platformProxy((c) => c.get('/internal/platform/newsletter/templates').then((r) => ({ data: r.data }))),
  postNewsletterTemplate: platformProxy((c, req) => c.post('/internal/platform/newsletter/templates', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putNewsletterTemplate: platformProxy((c, req) => c.put(`/internal/platform/newsletter/templates/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteNewsletterTemplate: platformProxy((c, req) => c.delete(`/internal/platform/newsletter/templates/${req.params.id}`).then(() => ({ status: 204 }))),
  sendNewsletter: platformProxy((c, req) => c.post('/internal/platform/newsletter/send', req.body).then((r) => ({ data: r.data }))),
  getBanners: platformProxy((c) => c.get('/internal/platform/banners').then((r) => ({ data: r.data }))),
  getBanner: platformProxy((c, req) => c.get(`/internal/platform/banners/${req.params.id}`).then((r) => ({ data: r.data }))),
  postBanner: platformProxy((c, req) => c.post('/internal/platform/banners', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putBanner: platformProxy((c, req) => c.put(`/internal/platform/banners/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteBanner: platformProxy((c, req) => c.delete(`/internal/platform/banners/${req.params.id}`).then(() => ({ status: 204 }))),
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

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) throw new AppError('No file uploaded', 400);
  const form = new FormData();
  form.append('file', req.file.buffer, {
    filename: req.file.originalname || 'file.pdf',
    contentType: req.file.mimetype,
  });
  const { data } = await platformClient.post('/internal/platform/upload/file', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  const payload = data?.success === true && data?.data !== undefined ? data.data : data;
  sendSuccess(res, payload);
});

// ── Course reviews (course-service) ─────────────────────────────────

const getCourseReviews = asyncHandler(async (req, res) => {
  const p = (await courseClient.get('/internal/course-reviews', { params: req.query })).data;
  sendPaginated(res, {
    data: p.data,
    meta: {
      total: p.total,
      page: p.page,
      limit: p.limit,
      totalPages: p.totalPages,
      hasNextPage: p.hasNextPage,
      hasPreviousPage: p.hasPreviousPage,
    },
  });
});

const getCourseReviewById = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/course-reviews/${req.params.id}`);
  sendSuccess(res, data);
});

const patchCourseReview = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.patch(`/internal/course-reviews/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_COURSE_REVIEW', 'course_review', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const deleteCourseReview = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.delete(`/internal/course-reviews/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_COURSE_REVIEW', 'course_review', req.params.id, {}, req.ip);
  sendNoContent(res);
});

// ── Affiliate proxy handlers ───────────────────────────────────────

const getAffiliateHistory = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/affiliate/history');
  sendSuccess(res, data);
});

const getWithdrawalRequests = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/affiliate/withdrawals');
  sendSuccess(res, data);
});

const getAffiliateBalance = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/affiliate/balance/${req.params.userId}`);
  sendSuccess(res, data);
});

const createWithdrawalRequest = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post('/internal/affiliate/withdrawals', req.body);
  await adminLogsService.logAction(adminId, 'CREATE_WITHDRAWAL_REQUEST', 'withdrawal_request', String(data.id), req.body, req.ip);
  sendCreated(res, data);
});

const updateWithdrawalStatus = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.patch(`/internal/affiliate/withdrawals/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_WITHDRAWAL_STATUS', 'withdrawal_request', req.params.id, req.body, req.ip);
  sendSuccess(res, data);
});

// ── Payment links (CMS checkout pages) ─────────────────────────────

const listPaymentLinksPublic = asyncHandler(async (req, res) => {
  const rows = await paymentLinkService.listPublishedPublic();
  sendSuccess(res, rows);
});

const getPaymentLinkPublicBySlug = asyncHandler(async (req, res) => {
  const data = await paymentLinkService.getPublishedBySlug(req.params.slug);
  sendSuccess(res, data);
});

const getPaymentLinkInternal = asyncHandler(async (req, res) => {
  const data = await paymentLinkService.getInternalForCheckout(req.params.id);
  sendSuccess(res, data);
});

const listPaymentLinksAdmin = asyncHandler(async (req, res) => {
  const { data, meta } = await paymentLinkService.listPaymentLinks({
    limit: req.query.limit,
    offset: req.query.offset,
    status: req.query.status,
    search: req.query.search,
  });
  sendPaginated(res, { data, meta });
});

const getPaymentLinkAdmin = asyncHandler(async (req, res) => {
  const row = await paymentLinkService.getPaymentLinkById(req.params.id);
  sendSuccess(res, row);
});

const postPaymentLink = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const created = await paymentLinkService.createPaymentLink(req.body);
  await adminLogsService.logAction(adminId, 'CREATE_PAYMENT_LINK', 'payment_link', String(created.id), { slug: created.slug }, req.ip);
  sendCreated(res, created);
});

const putPaymentLink = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const updated = await paymentLinkService.updatePaymentLink(req.params.id, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_PAYMENT_LINK', 'payment_link', req.params.id, {}, req.ip);
  sendSuccess(res, updated);
});

const deletePaymentLink = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await paymentLinkService.deletePaymentLink(req.params.id);
  await adminLogsService.logAction(adminId, 'DELETE_PAYMENT_LINK', 'payment_link', req.params.id, {}, req.ip);
  sendNoContent(res);
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
  getUserEnrollments,
  getUserMemberships,
  getBatches,
  addMaterial,
  getCourses,
  getCourse,
  getCourseSessions,
  listBatches,
  getCourseCats,
  createCourseCat,
  updateCourseCat,
  deleteCourseCat,
  getCoursePageSettings,
  updateCoursePageSetting,
  getOrders,
  getOrderByOrderId,
  createOrder,
  applyCouponAdmin,
  updateOrder,
  refundOrder,
  deleteOrder,
  getCoupons,
  getCoupon,
  postCoupon,
  putCoupon,
  deleteCoupon,
  checkCouponCodeExists,
  platform,
  uploadImage,
  uploadFile,
  getAffiliateHistory,
  getWithdrawalRequests,
  getAffiliateBalance,
  createWithdrawalRequest,
  updateWithdrawalStatus,
  getCourseReviews,
  getCourseReviewById,
  patchCourseReview,
  deleteCourseReview,
  listPaymentLinksPublic,
  getPaymentLinkPublicBySlug,
  getPaymentLinkInternal,
  listPaymentLinksAdmin,
  getPaymentLinkAdmin,
  postPaymentLink,
  putPaymentLink,
  deletePaymentLink,
};
