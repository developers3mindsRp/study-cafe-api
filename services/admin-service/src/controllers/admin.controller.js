const FormData = require('form-data');
const config = require('../config');
const courseClient = require('../clients/courseClient');
const orderClient = require('../clients/orderClient');
const platformClient = require('../clients/platformClient');
const authClient = require('../clients/authClient');
const adminLogsService = require('../services/adminLogs.service');
const userImportService = require('../services/userImport.service');
const paymentConfigService = require('../services/paymentConfig.service');
const paymentLinkService = require('../services/paymentLink.service');
const paymentGatewayService = require('../services/paymentGateway.service');
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
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent, sendPaginated, logger } = require('../../../../shared');

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

// ── Dashboard stats ────────────────────────────────────────────────

const PERIOD_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

function periodDates(days) {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  const prevTo = new Date(from);
  prevTo.setDate(prevTo.getDate() - 1);
  prevTo.setHours(23, 59, 59, 999);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  prevFrom.setHours(0, 0, 0, 0);
  return {
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    prevDateFrom: prevFrom.toISOString(),
    prevDateTo: prevTo.toISOString(),
  };
}

function delta(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return parseFloat((((current - previous) / previous) * 100).toFixed(1));
}

const getDashboardStats = asyncHandler(async (req, res) => {
  const period = PERIOD_DAYS[req.query.period] ? req.query.period : '30d';
  const days = PERIOD_DAYS[period];
  const { dateFrom, dateTo, prevDateFrom, prevDateTo } = periodDates(days);
  const deltaLabel = `vs last ${period}`;
  const bucket = days === 7 ? 'day' : days === 30 ? 'week' : 'month';

  const [usersRes, coursesRes, currOrders, prevOrders, revenueSeries, recentOrdersRes, recentArticlesRes] = await Promise.all([
    authClient.get('/users/internal/count'),
    courseClient.get('/internal/courses'),
    orderClient.get('/internal/orders/stats', { params: { dateFrom, dateTo } }),
    orderClient.get('/internal/orders/stats', { params: { dateFrom: prevDateFrom, dateTo: prevDateTo } }),
    orderClient.get('/internal/orders/revenue-series', { params: { dateFrom, dateTo, bucket } }),
    orderClient.get('/internal/orders', { params: { limit: 15, sortBy: 'created_at', sortOrder: 'DESC' } }),
    platformClient.get('/internal/platform/articles', { params: { limit: 5, sortBy: 'created_at', sortOrder: 'DESC', status: 'publish' } }).catch(() => ({ data: { data: [] } })),
  ]);

  const totalStudents = usersRes.data?.total ?? 0;
  const courses = Array.isArray(coursesRes.data) ? coursesRes.data : (coursesRes.data?.data ?? []);
  const activeCourses = courses.filter((c) => c.is_published).length;
  const { total_orders: currOrderCount, total_revenue: currRevenue } = currOrders.data;
  const { total_orders: prevOrderCount, total_revenue: prevRevenue } = prevOrders.data;

  function formatRevenue(amount) {
    if (amount >= 100000) return `₹${(amount / 100000).toFixed(1)}L`;
    if (amount >= 1000) return `₹${(amount / 1000).toFixed(1)}K`;
    return `₹${Math.round(amount)}`;
  }

  const stats = [
    {
      label: 'Total Students',
      value: totalStudents.toLocaleString('en-IN'),
      delta: 0,
      deltaLabel,
      iconKey: 'users',
    },
    {
      label: 'Active Courses',
      value: activeCourses,
      delta: 0,
      deltaLabel,
      iconKey: 'courses',
    },
    {
      label: 'Revenue',
      value: formatRevenue(currRevenue),
      delta: delta(currRevenue, prevRevenue),
      deltaLabel,
      iconKey: 'revenue',
    },
    {
      label: 'New Orders',
      value: currOrderCount,
      delta: delta(currOrderCount, prevOrderCount),
      deltaLabel,
      iconKey: 'orders',
    },
  ];

  // Top courses by enrollment (top 5, published only)
  const topCourses = courses
    .filter((c) => c.is_published)
    .sort((a, b) => (b.enrolled_count ?? 0) - (a.enrolled_count ?? 0))
    .slice(0, 5)
    .map((c) => ({
      id: String(c.id),
      title: c.title,
      category: Array.isArray(c.categories) && c.categories.length > 0 ? (c.categories[0]?.name ?? '') : '',
      enrollments: c.enrolled_count ?? 0,
      revenue: 0,
      trend: 0,
    }));

  // Revenue time-series for chart
  const revenueData = Array.isArray(revenueSeries.data) ? revenueSeries.data : [];

  // Activity feed: merge recent orders + recent articles, sort by date, take top 15
  const rawOrders = (() => {
    const d = recentOrdersRes.data;
    return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
  })();
  const rawArticles = (() => {
    const d = recentArticlesRes.data;
    return Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : []);
  })();

  const orderActivities = rawOrders.map((o) => ({
    id: `order-${o.id}`,
    type: o.type === 'membership' ? 'membership' : 'order',
    title: o.buyer_name
      ? `${o.buyer_name} — ${o.entity_name || (o.type === 'membership' ? 'Membership' : 'Course')}`
      : (o.entity_name || 'New order'),
    meta: o.amount != null ? `₹${Number(o.amount).toLocaleString('en-IN')}` : '',
    timestamp: o.created_at,
    status: o.status === 'paid' ? 'success' : o.status === 'failed' ? 'failed' : 'pending',
  }));

  const articleActivities = rawArticles.map((a) => ({
    id: `article-${a.id}`,
    type: 'article',
    title: a.title || 'Article published',
    meta: 'by Admin',
    timestamp: a.published_at || a.created_at,
    status: 'success',
  }));

  const activityFeed = [...orderActivities, ...articleActivities]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 15);

  sendSuccess(res, {
    period,
    stats,
    revenueData,
    activityFeed,
    topCourses,
  });
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
  const { data } = await courseClient.get('/internal/courses', { params: req.query });
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const deleteCourse = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.delete(`/internal/courses/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_COURSE', 'course', req.params.id, {}, req.ip);
  sendNoContent(res);
});

const restoreCourse = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.post(`/internal/courses/${req.params.id}/restore`);
  await adminLogsService.logAction(adminId, 'RESTORE_COURSE', 'course', req.params.id, {}, req.ip);
  sendNoContent(res);
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
  // courseClient interceptor spreads meta fields to root: { data, total, page, limit, ... }
  sendPaginated(res, {
    data: Array.isArray(payload.data) ? payload.data : [],
    meta: {
      total: payload.total ?? 0,
      page: payload.page ?? 1,
      limit: payload.limit ?? 10,
      totalPages: payload.totalPages ?? 0,
      hasNextPage: payload.hasNextPage ?? false,
      hasPreviousPage: payload.hasPreviousPage ?? false,
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

  // Mirror exactly what the frontend profile page uses:
  // 1. GET /orders/my-purchases  → listMyPurchases() with full accessStatus logic
  // 2. GET /user/courses          → myCourses() from user_courses table (admin-granted rows)
  // Both are fetched in parallel to match the frontend MyCoursesSection pipeline.
  let purchases = [];
  let userCourses = [];
  try {
    const [purchasesRes, userCoursesRes] = await Promise.allSettled([
      orderClient.get(`/internal/users/${userId}/purchases`),
      authClient.get(`/internal/users/${userId}/courses`),
    ]);
    if (purchasesRes.status === 'fulfilled') {
      const d = purchasesRes.value.data;
      purchases = Array.isArray(d) ? d : (d?.data || []);
    } else {
      logger.warn(`Failed to fetch purchases from order-service for user ${userId}: ${purchasesRes.reason?.message}`);
    }
    if (userCoursesRes.status === 'fulfilled') {
      const d = userCoursesRes.value.data;
      userCourses = Array.isArray(d) ? d : (d?.data || []);
    } else {
      logger.warn(`Failed to fetch user courses from auth-service for user ${userId}: ${userCoursesRes.reason?.message}`);
    }
  } catch (err) {
    logger.warn(`Failed to fetch course data for user ${userId}: ${err.message}`);
  }

  // Enrich from course-service (batch titles, enrollment ids).
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

  // Build result list — one record per ORDER (not per course), matching frontend behaviour.
  // Frontend does NOT deduplicate: a course repurchased twice shows two cards.
  const results = [];

  // Track which courseIds are covered by paid orders so admin-granted rows aren't double-counted.
  const purchasedCourseIds = new Set();

  for (const p of purchases) {
    if (!p.course || p.courseId == null) continue;
    if (!isUserCourseOrderPurchase(p)) continue;

    const cid = String(p.courseId);
    purchasedCourseIds.add(cid);

    const e = enrollmentByCourseId.get(cid);
    results.push({
      enrollment_id: e?.enrollment_id ?? null,
      course_id: Number(cid),
      course_title: e?.course_title ?? p.course?.title ?? 'Unknown Course',
      batch_id: e?.batch_id ?? p.batchId ?? null,
      batch_name: e?.batch_name ?? p.enrolledBatch?.name ?? null,
      enrolled_at: e?.enrolled_at ?? p.purchaseDate ?? null,
      order_id: p.id != null ? String(p.id) : null,
      purchase_status: p.status ?? null,
      // Mirror the exact accessStatus logic from frontend (listMyPurchases):
      // wp_post_status is authoritative for legacy orders; user_courses.expires_at for native.
      access_status: p.accessStatus ?? 'active',
      access_expires_at: p.accessExpiresAt ?? null,
      wp_post_status: p.wpPostStatus ?? null,
      from_purchase: true,
      is_admin_granted: false,
    });
  }

  // Add admin-granted courses (order_id IS NULL in user_courses) not already in paid orders.
  for (const uc of userCourses) {
    if (!uc.isAdminGranted) continue;
    const cid = String(uc.courseId);
    if (purchasedCourseIds.has(cid)) continue;

    const e = enrollmentByCourseId.get(cid);
    results.push({
      enrollment_id: e?.enrollment_id ?? null,
      course_id: Number(cid),
      course_title: uc.course?.title ?? e?.course_title ?? 'Unknown Course',
      batch_id: e?.batch_id ?? null,
      batch_name: e?.batch_name ?? null,
      enrolled_at: e?.enrolled_at ?? null,
      order_id: null,
      purchase_status: 'admin-granted',
      access_status: uc.accessStatus ?? 'active',
      access_expires_at: uc.accessExpiresAt ?? null,
      wp_post_status: null,
      from_purchase: false,
      is_admin_granted: true,
    });
  }

  // Sort: active first (newest enrolled_at), then expired (newest enrolled_at).
  results.sort((a, b) => {
    const aExpired = a.access_status === 'expired' ? 1 : 0;
    const bExpired = b.access_status === 'expired' ? 1 : 0;
    if (aExpired !== bExpired) return aExpired - bExpired;
    const dateA = a.enrolled_at ? new Date(a.enrolled_at).getTime() : 0;
    const dateB = b.enrolled_at ? new Date(b.enrolled_at).getTime() : 0;
    return dateB - dateA;
  });

  const active = results.filter((r) => r.access_status !== 'expired');
  const expired = results.filter((r) => r.access_status === 'expired');

  sendSuccess(res, {
    active_count: active.length,
    expired_count: expired.length,
    total_count: results.length,
    active_courses: active,
    expired_courses: expired,
  });
});

const getUserMemberships = asyncHandler(async (req, res) => {
  const { data } = await authClient.get(`/internal/users/${req.params.id}/memberships`);
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

const grantUserMembership = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { membershipType, startsAt, expiresAt, price, paymentId, planValidity, planPurchasedFormatted, planExpiryFormatted } = req.body;
  if (!membershipType || !startsAt || !expiresAt) {
    throw new AppError('membershipType, startsAt, and expiresAt are required', 400);
  }
  const planJson = (price || paymentId || planValidity || planPurchasedFormatted)
    ? {
        price: price ? String(price) : undefined,
        plan_validity: planValidity ? String(planValidity) : undefined,
        plan_purchased: planPurchasedFormatted || startsAt,
        plan_expiry: planExpiryFormatted || expiresAt,
        payment_id: paymentId ? String(paymentId) : undefined,
      }
    : null;
  await authClient.post('/access/grant-membership', {
    userId: req.params.id,
    membershipType,
    startsAt,
    expiresAt,
    orderId: null,
    ...(planJson ? { planJson } : {}),
  });

  // Create a manual order record when price or paymentId is provided
  if (price || paymentId) {
    try {
      const { data: contact } = await authClient.get(`/internal/users/${req.params.id}/contact`);
      await orderClient.post('/internal/orders', {
        user_id: req.params.id,
        type: 'membership',
        entity_id: membershipType,
        amount: price ? Number(price) : 0,
        buyer_email: contact?.email || null,
        buyer_name: contact?.name || null,
        buyer_mobile: contact?.phone || null,
        status: 'paid',
        payment_id: paymentId || undefined,
      });
    } catch (orderErr) {
      console.error('[grantUserMembership] order creation failed:', orderErr?.response?.data ?? orderErr?.message ?? orderErr);
    }
  }

  await adminLogsService.logAction(adminId, 'GRANT_MEMBERSHIP', 'user_membership', String(req.params.id), { membershipType, startsAt, expiresAt, paymentId }, req.ip);
  sendSuccess(res, { granted: true });
});

const getUserDistinctStates = asyncHandler(async (req, res) => {
  const { data } = await authClient.get('/users/distinct-states');
  sendSuccess(res, Array.isArray(data) ? data : []);
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

const bulkAddBatchEnrollmentByEmails = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const batchId = req.params.id;
  const { emails: rawEmails, price, paymentId, courseId } = req.body;
  const emails = Array.isArray(rawEmails) ? rawEmails : [];

  if (emails.length === 0) {
    return sendSuccess(res, []);
  }

  // Resolve emails → user ids via auth service
  const { data: users } = await authClient.post('/internal/users/by-emails', { emails });
  const userMap = new Map((Array.isArray(users) ? users : []).map((u) => [u.email.toLowerCase(), u]));

  const results = await Promise.all(
    emails.map(async (email) => {
      const normalized = email.toLowerCase();
      const user = userMap.get(normalized);
      if (!user) {
        return { email: normalized, status: 'user_not_found' };
      }
      try {
        const { data } = await courseClient.post(`/internal/batches/${batchId}/enrollments`, { user_id: user.id });
        const status = data.created === false ? 'already_enrolled' : 'enrolled';
        if (status === 'enrolled') {
          await adminLogsService.logAction(adminId, 'ADD_BATCH_ENROLLMENT', 'batch_enrollment', String(data.id), { batchId, userId: user.id }, req.ip);

          // Create a manual order record when price or paymentId is provided
          if ((price || paymentId) && courseId) {
            try {
              await orderClient.post('/internal/orders', {
                user_id: user.id,
                type: 'course',
                entity_id: String(courseId),
                amount: price ? Number(price) : 0,
                buyer_email: user.email,
                buyer_name: user.name || null,
                buyer_mobile: user.phone || null,
                status: 'paid',
                payment_id: paymentId || undefined,
              });
            } catch (orderErr) {
              console.error('[bulkEnroll] order creation failed:', orderErr?.response?.data ?? orderErr?.message ?? orderErr);
            }
          }
        }
        return { email: normalized, status };
      } catch (err) {
        return { email: normalized, status: 'error', message: err?.response?.data?.error || err.message };
      }
    })
  );

  sendSuccess(res, results);
});

const bulkGrantMembershipByEmails = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { emails, membershipType, startsAt, expiresAt, price, paymentId, planValidity, planPurchasedFormatted, planExpiryFormatted } = req.body;

  if (!Array.isArray(emails) || emails.length === 0) {
    return sendSuccess(res, []);
  }
  if (!membershipType || !startsAt || !expiresAt) {
    throw new AppError('membershipType, startsAt and expiresAt are required', 400);
  }

  // Build the plan JSON object to store on users.plan when any payment detail is provided.
  const planJson = (price || paymentId || planValidity || planPurchasedFormatted)
    ? {
        price: price ? String(price) : undefined,
        plan_validity: planValidity ? String(planValidity) : undefined,
        plan_purchased: planPurchasedFormatted || startsAt,
        plan_expiry: planExpiryFormatted || expiresAt,
        payment_id: paymentId ? String(paymentId) : undefined,
      }
    : null;

  // Resolve emails → user ids
  const { data: users } = await authClient.post('/internal/users/by-emails', { emails });
  const userMap = new Map((Array.isArray(users) ? users : []).map((u) => [u.email.toLowerCase(), u]));

  const results = await Promise.all(
    emails.map(async (email) => {
      const normalized = email.toLowerCase();
      const user = userMap.get(normalized);
      if (!user) {
        return { email: normalized, status: 'user_not_found' };
      }
      try {
        await authClient.post('/access/grant-membership', {
          userId: user.id,
          membershipType,
          startsAt,
          expiresAt,
          orderId: null,
          ...(planJson ? { planJson } : {}),
        });

        // Create a manual order record when price or paymentId is provided
        if (price || paymentId) {
          try {
            await orderClient.post('/internal/orders', {
              user_id: user.id,
              type: 'membership',
              entity_id: membershipType,
              amount: price ? Number(price) : 0,
              buyer_email: user.email,
              buyer_name: user.name || null,
              buyer_mobile: user.phone || null,
              status: 'paid',
              payment_id: paymentId || undefined,
            });
          } catch (orderErr) {
            console.error('[bulkGrantMembership] order creation failed:', orderErr?.response?.data ?? orderErr?.message ?? orderErr);
          }
        }

        await adminLogsService.logAction(adminId, 'BULK_GRANT_MEMBERSHIP', 'user_membership', String(user.id), { membershipType, startsAt, expiresAt, paymentId }, req.ip);
        return { email: normalized, status: 'granted' };
      } catch (err) {
        return { email: normalized, status: 'error', message: err?.response?.data?.error || err.message };
      }
    })
  );

  sendSuccess(res, results);
});

const importUsersFromCsv = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { rows } = req.body;

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new AppError('rows array is required', 400);
  }
  if (rows.length > userImportService.MAX_ROWS) {
    throw new AppError(`Maximum ${userImportService.MAX_ROWS} rows per import`, 400);
  }

  try {
    const summary = await userImportService.importUsers({
      rows,
      adminId,
      reqIp: req.ip,
    });
    sendSuccess(res, summary);
  } catch (err) {
    throw new AppError(err.message || 'Import failed', 400);
  }
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

const getMarketingPages = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/marketing-pages');
  sendSuccess(res, data);
});

const getMarketingPage = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/marketing-pages/${req.params.id}`);
  sendSuccess(res, data);
});

const postMarketingPage = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post('/internal/marketing-pages', req.body);
  await adminLogsService.logAction(adminId, 'CREATE_MARKETING_PAGE', 'marketing_page', String(data.id), { slug: data.slug }, req.ip);
  sendCreated(res, data);
});

const putMarketingPage = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/marketing-pages/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_MARKETING_PAGE', 'marketing_page', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const deleteMarketingPage = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.delete(`/internal/marketing-pages/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_MARKETING_PAGE', 'marketing_page', req.params.id, {}, req.ip);
  sendSuccess(res, { deleted: true });
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

const restoreOrder = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await orderClient.post(`/internal/orders/${req.params.id}/restore`);
  await adminLogsService.logAction(adminId, 'RESTORE_ORDER', 'order', req.params.id, {}, req.ip);
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

const getCouponUsages = asyncHandler(async (req, res) => {
  const { data } = await orderClient.get('/internal/coupon-usages', { params: req.query });
  if (data && typeof data === 'object' && 'data' in data && 'meta' in data) {
    if (data.summary) {
      data.meta = { ...data.meta, summary: data.summary };
    }
    return sendPaginated(res, data);
  }
  sendSuccess(res, data);
});

const getCouponUsageSummary = asyncHandler(async (req, res) => {
  const { data } = await orderClient.get('/internal/coupon-usages/summary');
  sendSuccess(res, Array.isArray(data) ? data : data || []);
});

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
  getGoogleReviews: platformProxy((c) => c.get('/internal/platform/google-reviews').then((r) => ({ data: r.data }))),
  postGoogleReview: platformProxy((c, req) => c.post('/internal/platform/google-reviews', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putGoogleReview: platformProxy((c, req) => c.put(`/internal/platform/google-reviews/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteGoogleReview: platformProxy((c, req) => c.delete(`/internal/platform/google-reviews/${req.params.id}`).then(() => ({ status: 204 }))),
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
  getArticleStatusCounts: platformProxy((c) => c.get('/internal/platform/articles/counts').then((r) => ({ data: r.data }))),
  getArticles: platformProxy((c, req) => c.get('/internal/platform/articles', { params: req.query }).then((r) => ({ data: r.data }))),
  getArticle: platformProxy((c, req) => c.get(`/internal/platform/articles/${req.params.id}`).then((r) => ({ data: r.data }))),
  postArticle: platformProxy((c, req) => {
    const adminId = getAdminId(req);
    const body = adminId && !req.body.author_id ? { ...req.body, author_id: adminId } : req.body;
    return c.post('/internal/platform/articles', body).then((r) => ({ data: r.data, status: 201 }));
  }),
  putArticle: platformProxy((c, req) => {
    const body = { ...req.body };
    delete body.author_id;
    delete body.author_name;
    delete body.author_role;
    
    return c.put(`/internal/platform/articles/${req.params.id}`, body).then((r) => ({ data: r.data }));
  }),
  deleteArticle: platformProxy((c, req) => c.delete(`/internal/platform/articles/${req.params.id}`).then(() => ({ status: 204 }))),
  restoreArticle: platformProxy((c, req) => c.post(`/internal/platform/articles/${req.params.id}/restore`).then(() => ({ status: 204 }))),
  getArticleCategories: platformProxy((c) => c.get('/internal/platform/article-categories').then((r) => ({ data: r.data }))),
  getArticleCategory: platformProxy((c, req) => c.get(`/internal/platform/article-categories/${req.params.id}`).then((r) => ({ data: r.data }))),
  createArticleCategory: platformProxy((c, req) => c.post('/internal/platform/article-categories', req.body).then((r) => ({ data: r.data, status: 201 }))),
  updateArticleCategory: platformProxy((c, req) => c.put(`/internal/platform/article-categories/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteArticleCategory: platformProxy((c, req) => c.delete(`/internal/platform/article-categories/${req.params.id}`).then(() => ({ status: 204 }))),
  getTags: platformProxy((c) => c.get('/internal/platform/tags').then((r) => ({ data: r.data }))),
  getTag: platformProxy((c, req) => c.get(`/internal/platform/tags/${req.params.id}`).then((r) => ({ data: r.data }))),
  createTag: platformProxy((c, req) => c.post('/internal/platform/tags', req.body).then((r) => ({ data: r.data, status: 201 }))),
  updateTag: platformProxy((c, req) => c.put(`/internal/platform/tags/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteTag: platformProxy((c, req) => c.delete(`/internal/platform/tags/${req.params.id}`).then(() => ({ status: 204 }))),
  getArticleTypes: platformProxy((c) => c.get('/internal/platform/article-types').then((r) => ({ data: r.data }))),
  getArticleType: platformProxy((c, req) => c.get(`/internal/platform/article-types/${req.params.id}`).then((r) => ({ data: r.data }))),
  createArticleType: platformProxy((c, req) => c.post('/internal/platform/article-types', req.body).then((r) => ({ data: r.data, status: 201 }))),
  updateArticleType: platformProxy((c, req) => c.put(`/internal/platform/article-types/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteArticleType: platformProxy((c, req) => c.delete(`/internal/platform/article-types/${req.params.id}`).then(() => ({ status: 204 }))),
  getCourts: platformProxy((c) => c.get('/internal/platform/courts').then((r) => ({ data: r.data }))),
  getCourt: platformProxy((c, req) => c.get(`/internal/platform/courts/${req.params.id}`).then((r) => ({ data: r.data }))),
  createCourt: platformProxy((c, req) => c.post('/internal/platform/courts', req.body).then((r) => ({ data: r.data, status: 201 }))),
  updateCourt: platformProxy((c, req) => c.put(`/internal/platform/courts/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteCourt: platformProxy((c, req) => c.delete(`/internal/platform/courts/${req.params.id}`).then(() => ({ status: 204 }))),
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
  syncMembershipSubscribers: platformProxy((c, req) => c.post('/internal/platform/newsletter/sync-members', req.body).then((r) => ({ data: r.data }))),
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

const createArticlePreviewToken = asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw new AppError('Invalid article id', 400);
  const [tokenResult, articleResult] = await Promise.all([
    platformClient.post(`/internal/platform/articles/${articleId}/preview-token`),
    platformClient.get(`/internal/platform/articles/${articleId}`),
  ]);
  const token = tokenResult.data.token;
  const slug = articleResult.data.slug;
  const frontendUrl = config.frontendUrl;
  const previewUrl = `${frontendUrl}/${slug}-${articleId}.html?preview_token=${token}`;
  sendSuccess(res, { previewUrl, expiresInSeconds: 900 });
});

const createCoursePreviewToken = asyncHandler(async (req, res) => {
  const courseId = Number(req.params.id);
  if (!Number.isFinite(courseId) || courseId <= 0) throw new AppError('Invalid course id', 400);
  const [tokenResult, courseResult] = await Promise.all([
    courseClient.post(`/internal/courses/${courseId}/preview-token`),
    courseClient.get(`/internal/courses/${courseId}`),
  ]);
  const token = tokenResult.data.token;
  const slug = courseResult.data.slug;
  const frontendUrl = config.frontendUrl;
  const previewUrl = `${frontendUrl}/course/${slug}?preview_token=${token}`;
  sendSuccess(res, { previewUrl, expiresInSeconds: 900 });
});

const getPaymentGateways = asyncHandler(async (req, res) => {
  const list = await paymentGatewayService.listPaymentGateways();
  sendSuccess(res, list);
});

const getPaymentGateway = asyncHandler(async (req, res) => {
  const item = await paymentGatewayService.getPaymentGatewayById(req.params.id);
  sendSuccess(res, item);
});

const createPaymentGateway = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const item = await paymentGatewayService.createPaymentGateway(req.body);
  await adminLogsService.logAction(adminId, 'CREATE_PAYMENT_GATEWAY', 'payment_gateway', String(item.id), { name: item.name }, req.ip);
  sendCreated(res, item);
});

const updatePaymentGateway = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const item = await paymentGatewayService.updatePaymentGateway(req.params.id, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_PAYMENT_GATEWAY', 'payment_gateway', req.params.id, { name: item.name, is_active: item.is_active }, req.ip);
  sendSuccess(res, item);
});

const deletePaymentGateway = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const result = await paymentGatewayService.deletePaymentGateway(req.params.id);
  await adminLogsService.logAction(adminId, 'DELETE_PAYMENT_GATEWAY', 'payment_gateway', req.params.id, {}, req.ip);
  sendSuccess(res, result);
});

module.exports = {
  me,
  getPaymentConfigInternal,
  getStats,
  getDashboardStats,
  updatePaymentConfig,
  getLogs,
  getPaymentGateways,
  getPaymentGateway,
  createPaymentGateway,
  updatePaymentGateway,
  deletePaymentGateway,
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
  bulkAddBatchEnrollmentByEmails,
  bulkGrantMembershipByEmails,
  importUsersFromCsv,
  removeBatchEnrollment,
  getUserEnrollments,
  getUserMemberships,
  grantUserMembership,
  getUserDistinctStates,
  getBatches,
  addMaterial,
  getCourses,
  deleteCourse,
  restoreCourse,
  getCourse,
  getCourseSessions,
  listBatches,
  getCourseCats,
  createCourseCat,
  updateCourseCat,
  deleteCourseCat,
  getCoursePageSettings,
  updateCoursePageSetting,
  getMarketingPages,
  getMarketingPage,
  postMarketingPage,
  putMarketingPage,
  deleteMarketingPage,
  getOrders,
  getOrderByOrderId,
  createOrder,
  applyCouponAdmin,
  updateOrder,
  refundOrder,
  deleteOrder,
  restoreOrder,
  getCouponUsages,
  getCouponUsageSummary,
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
  createCoursePreviewToken,
  createArticlePreviewToken,
};
