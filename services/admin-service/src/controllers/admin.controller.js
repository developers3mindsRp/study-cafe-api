const FormData = require('form-data');
const axios = require('axios');
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
const { sequelize, Coupon, PabblyWebhook } = require('../models');
const { Op } = require('sequelize');

/**
 * Run an async worker over `items` with a bounded number of concurrent tasks.
 * Firing every request at once (e.g. Promise.all over 1000 emails) saturates the
 * downstream services' socket/DB pools, so most calls sit queued past their 10s
 * axios timeout and fail with "timeout of 10000ms exceeded". A small pool keeps
 * throughput high while staying under those limits. Results preserve input order.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Max in-flight per-email tasks for bulk operations. Each task hits course-service
// then order-service sequentially, so 10 workers map 1:1 onto each downstream DB
// pool (max 10) without queueing past the 10s axios timeout, while ~1000 users still
// finish well inside the 120s api-gateway proxy timeout.
const BULK_CONCURRENCY = 10;

/**
 * Create a manual 'paid' course order so an admin-allotted course surfaces under
 * the user's "Purchased Course" tab (order-service GET /orders/my-purchases reads
 * the orders table). Best-effort: failures are logged, never thrown, so a broken
 * order write can't fail the enrollment itself — but the outcome is returned so the
 * caller can tell the admin instead of reporting a clean save.
 *
 * Booked in shared-payment mode, like bulk allotment. One settlement routinely covers a
 * membership and the courses allotted with it, and `payments` is UNIQUE on the
 * reference: without shared mode the second order carrying that reference is rejected,
 * and the learner ends up enrolled with no order at all.
 *
 * @returns {Promise<{ created: boolean, error?: string }>}
 */
async function createCourseOrder({ userId, courseId, price, paymentId, contact }) {
  if (!courseId) return { created: false, error: 'courseId is required to record the order' };
  try {
    let buyer = contact || null;
    if (!buyer) {
      try {
        const { data } = await authClient.get(`/internal/users/${userId}/contact`);
        buyer = data || null;
      } catch (contactErr) {
        console.error('[createCourseOrder] contact lookup failed:', contactErr?.response?.data ?? contactErr?.message ?? contactErr);
      }
    }
    await orderClient.post('/internal/orders', {
      user_id: userId,
      type: 'course',
      entity_id: String(courseId),
      amount: price ? Number(price) : 0,
      buyer_email: buyer?.email || null,
      buyer_name: buyer?.name || null,
      buyer_mobile: buyer?.phone || null,
      status: 'paid',
      payment_id: paymentId || undefined,
      shared_payment_id: true,
    });
    return { created: true };
  } catch (orderErr) {
    console.error('[createCourseOrder] order creation failed:', orderErr?.response?.data ?? orderErr?.message ?? orderErr);
    return {
      created: false,
      error: orderErr?.response?.data?.error || orderErr?.message || 'Order could not be created',
    };
  }
}

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

/** Full course rows for the admin CSV export — heavier than getCourses(). */
const getCoursesForExport = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/courses/export', {
    params: req.query,
    timeout: 60000,
  });
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

const deleteCoursePermanently = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.delete(`/internal/courses/${req.params.id}/permanent`);
  await adminLogsService.logAction(adminId, 'DELETE_COURSE_PERMANENT', 'course', req.params.id, {}, req.ip);
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
  // courseClient deliberately does NOT unwrap paginated responses (it skips any body with
  // a `meta` key), so course-service's counts arrive under payload.meta — not at the root.
  // Reading them off the root reported total: 0 on every request, which also silently
  // disabled the Live Sessions batch table's pagination (it renders only when total > 0).
  // Root is kept as a fallback in case the upstream shape is ever flattened.
  const upstreamMeta =
    payload && typeof payload === 'object' && payload.meta && typeof payload.meta === 'object'
      ? payload.meta
      : payload || {};
  sendPaginated(res, {
    data: Array.isArray(payload.data) ? payload.data : [],
    meta: {
      total: upstreamMeta.total ?? 0,
      page: upstreamMeta.page ?? 1,
      limit: upstreamMeta.limit ?? 10,
      totalPages: upstreamMeta.totalPages ?? 0,
      hasNextPage: upstreamMeta.hasNextPage ?? false,
      hasPreviousPage: upstreamMeta.hasPreviousPage ?? false,
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
  const rows = Array.isArray(data) ? data : data || [];

  const courseId = rows[0]?.course_id;
  const userIds = rows.map((r) => r.user_id).filter(Boolean);
  if (courseId && userIds.length) {
    try {
      const { data: sources } = await orderClient.get(
        `/internal/courses/${courseId}/enrollment-sources`,
        { params: { userIds: userIds.join(',') } }
      );
      const sourceList = Array.isArray(sources) ? sources : sources?.data || [];
      const sourceByUser = new Map(sourceList.map((s) => [Number(s.user_id), s]));
      for (const row of rows) {
        const s = sourceByUser.get(Number(row.user_id));
        row.enrollment_source = s?.source || 'unknown';
        row.is_membership_linked = s?.is_membership_linked || false;
        row.source_order_id = s?.order_id || null;
        row.source_order_status = s?.order_status || null;
        row.source_order_was_refunded = s?.order_was_refunded || false;
      }
    } catch (err) {
      logger.warn(`Failed to resolve enrollment sources for batch ${req.params.id}: ${err.message}`);
    }
  }

  sendSuccess(res, rows);
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
      // includeRevoked: deallotted grants come back flagged rather than missing, which is
      // what separates "an admin removed this" from "the grant was never written".
      authClient.get(`/internal/users/${userId}/courses`, { params: { includeRevoked: 1 } }),
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

  /**
   * Courses an admin explicitly deallotted (user_courses.revoked_at is stamped).
   *
   * Deliberately NOT "every course without a grant row". The grant is written
   * asynchronously by order-service's outbox worker, so a paid order legitimately has no
   * row for a while — and a couple of hundred older paid orders have none at all.
   * Inferring removal from an absent row would report all of those as deallotted and
   * hide courses nobody touched, so only positive evidence counts here.
   */
  const revokedCourseIds = new Set(
    userCourses
      .filter((uc) => uc.isRevoked)
      .map((uc) => String(uc.courseId))
      .filter((cid) => cid && cid !== 'undefined'),
  );

  for (const p of purchases) {
    if (!p.course || p.courseId == null) continue;
    if (!isUserCourseOrderPurchase(p)) continue;

    const cid = String(p.courseId);
    purchasedCourseIds.add(cid);

    const e = enrollmentByCourseId.get(cid);
    const isRevoked = revokedCourseIds.has(cid);
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
      //
      // One admin-only correction: listMyPurchases derives access from the grant's expiry
      // and knows nothing about revocation, so a deallotted course would still report
      // 'active'. A revoked grant means no access, so show it as expired rather than
      // telling the admin the course they just removed is live.
      access_status: isRevoked ? 'expired' : (p.accessStatus ?? 'active'),
      access_expires_at: p.accessExpiresAt ?? null,
      wp_post_status: p.wpPostStatus ?? null,
      from_purchase: true,
      is_admin_granted: false,
      // false ONLY for an explicit deallotment, so the edit form stops re-offering it as
      // a current allotment. A course whose grant simply hasn't been written stays true.
      has_access_grant: !isRevoked,
    });
  }

  // Add admin-granted courses (order_id IS NULL in user_courses) not already in paid orders.
  for (const uc of userCourses) {
    if (!uc.isAdminGranted) continue;
    // A revoked admin grant is a removed allotment with no order behind it — there is
    // nothing left to show, so it drops out of the list entirely.
    if (uc.isRevoked) continue;
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
      // These rows come from user_courses, so the grant exists by construction.
      has_access_grant: true,
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
  let orderOutcome = null;
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
        // The courses allotted alongside this membership are usually paid by the same
        // settlement and are booked against the same reference (see createCourseOrder).
        shared_payment_id: true,
      });
      orderOutcome = { orderCreated: true };
    } catch (orderErr) {
      console.error('[grantUserMembership] order creation failed:', orderErr?.response?.data ?? orderErr?.message ?? orderErr);
      orderOutcome = {
        orderCreated: false,
        orderError: orderErr?.response?.data?.error || orderErr?.message || 'Order could not be created',
      };
    }
  }

  await adminLogsService.logAction(adminId, 'GRANT_MEMBERSHIP', 'user_membership', String(req.params.id), { membershipType, startsAt, expiresAt, paymentId }, req.ip);
  sendSuccess(res, { granted: true, ...(orderOutcome || {}) });
});

// Downgrade a user to the Free tier — expires every active membership row and
// resets users.membership/plan. Backs the "Free" option in the user edit form.
const removeUserMembership = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await authClient.post('/access/remove-membership', { userId: req.params.id });
  await adminLogsService.logAction(adminId, 'REMOVE_MEMBERSHIP', 'user_membership', String(req.params.id), {}, req.ip);
  sendSuccess(res, { removed: true });
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
  const { user_id, price, paymentId, courseId } = req.body;
  const { data } = await courseClient.post(`/internal/batches/${req.params.id}/enrollments`, { user_id });
  await adminLogsService.logAction(adminId, 'ADD_BATCH_ENROLLMENT', 'batch_enrollment', String(data.id), { batchId: req.params.id, userId: user_id }, req.ip);

  // Always create a manual course order on a fresh enrollment so the course shows
  // under "Purchased Course". Skip re-enrollments (created === false) to avoid dupes.
  if (data.created !== false && courseId) {
    const order = await createCourseOrder({ userId: user_id, courseId, price, paymentId });
    return sendCreated(res, { ...data, orderCreated: order.created, orderError: order.error || null });
  }

  sendCreated(res, data);
});

// Atomically set a user's batch for a course (param :id = courseId). Removes any other batch of
// the same course, then ensures the target enrollment — so switching a batch never leaves the user
// enrolled in two batches at once. A course order is minted ONLY on a first-time enrollment
// (firstEnrollment === true); a pure batch switch does not create a new order.
const setUserCourseBatch = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const courseId = req.params.id;
  const { user_id, batch_id, price, paymentId } = req.body;
  const { data } = await courseClient.post(`/internal/courses/${courseId}/set-batch`, {
    user_id,
    batch_id,
  });
  await adminLogsService.logAction(
    adminId,
    'SET_USER_COURSE_BATCH',
    'batch_enrollment',
    String(data.id ?? ''),
    { courseId, batchId: batch_id, userId: user_id },
    req.ip,
  );

  if (data.firstEnrollment && courseId) {
    const order = await createCourseOrder({ userId: user_id, courseId, price, paymentId });
    return sendSuccess(res, { ...data, orderCreated: order.created, orderError: order.error || null });
  }

  sendSuccess(res, data);
});

// Course orders per bulk request to order-service. Each chunk creates its orders at
// bounded concurrency inside order-service, so a large allotment never becomes a storm
// of per-user order calls (the pattern that overloaded order-service). Kept well under
// what fits in BULK_ORDER_TIMEOUT_MS: a chunk that times out is reported failed for
// every user in it — including orders that did commit — so re-running would double-book.
const BULK_ORDER_CHUNK = 50;
const BULK_ORDER_TIMEOUT_MS = 120000;

const BULK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches payments.razorpay_payment_id — a longer value fails at the DB layer.
const MAX_PAYMENT_ID_LENGTH = 128;

/**
 * Parse an admin-supplied amount ("12,979", "₹12979", "Rs. 999", "", 12979) into a number.
 *
 * Currency prefixes, thousands separators and stray spaces are stripped rather than
 * rejected — they're exactly what gateway exports and Excel produce. Anything still
 * unparseable returns null so the caller can report that row: passing it straight to
 * `Number(x) || 0` (as order-service does) would silently record a ₹12,979 paid
 * allotment as a ₹0 free one, with a real payment id attached.
 */
function parseAllotmentAmount(value) {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/^(?:rs\.?|inr)\s*/i, '').replace(/[₹,\s]/g, '');
  if (!cleaned) return 0;
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Normalize a bulk-allotment body into one validated row per user.
 *
 * Accepts the row form (`entries: [{ email, price, paymentId }]`, from the CSV) and the
 * legacy flat form (`emails: string[]`); the top-level price/paymentId are defaults for
 * rows that leave those cells blank. Every rejection becomes a per-row `invalid` result
 * with a message the admin can act on — never a throw, so one bad row can't cost the
 * rest of the upload.
 *
 * `allowSharedPaymentId` reflects how the caller's order route books payments. Course
 * allotment gives each order the payment id verbatim, so one id can only back one order
 * and a repeat must be rejected here. Membership allotment books orders in shared mode
 * (see sharedPaymentRef in orders.service), where one settlement reference legitimately
 * covers the whole run — so repeats are allowed and the form-level id applies to every
 * row rather than only a single-row upload.
 */
function normalizeAllotmentEntries(body, { allowSharedPaymentId = false } = {}) {
  const rawRows = Array.isArray(body.entries) && body.entries.length > 0
    ? body.entries
    : (Array.isArray(body.emails) ? body.emails.map((email) => ({ email })) : []);

  const defaultPaymentId =
    allowSharedPaymentId || rawRows.length === 1 ? String(body.paymentId ?? '').trim() : '';
  const hasValue = (v) => v != null && String(v).trim() !== '';

  const rows = [];
  const seenEmails = new Set();
  const seenPaymentIds = new Set();

  rawRows.forEach((raw, index) => {
    const entry = raw && typeof raw === 'object' ? raw : { email: raw };
    const email = entry.email == null ? '' : String(entry.email).trim().toLowerCase();
    const reject = (message) => rows.push({ index, email, status: 'invalid', message });

    // A blank line in a pasted list or a trailing CSV newline isn't an error worth
    // reporting — it's just noise. Anything non-blank that isn't an address is.
    if (!email) return;
    if (!BULK_EMAIL_RE.test(email)) {
      return reject('Not a valid email address');
    }
    if (seenEmails.has(email)) {
      return reject('Duplicate email in this file — only the first row was used');
    }

    const amount = parseAllotmentAmount(hasValue(entry.price) ? entry.price : body.price);
    if (amount === null) {
      return reject(`"${String(entry.price ?? body.price).trim()}" is not a valid amount — use a number like 12979`);
    }
    if (amount < 0) {
      return reject('Amount cannot be negative');
    }

    // A payment id is recorded whatever the amount, matching the single-user allot form.
    // On a ₹0 order the gateway still resolves to FREE (that's driven by the amount, not
    // the id), so the order reads as "Free" while carrying the real capture reference.
    const paymentId = String(hasValue(entry.paymentId) ? entry.paymentId : defaultPaymentId).trim();
    if (paymentId) {
      if (paymentId.length > MAX_PAYMENT_ID_LENGTH) {
        return reject(`Payment ID must be ${MAX_PAYMENT_ID_LENGTH} characters or fewer`);
      }
      if (!allowSharedPaymentId && seenPaymentIds.has(paymentId)) {
        return reject(`Payment ID ${paymentId} is used more than once in this file`);
      }
      seenPaymentIds.add(paymentId);
    }

    seenEmails.add(email);
    rows.push({ index, email, amount, paymentId, status: 'pending' });
  });

  return rows;
}

const bulkAddBatchEnrollmentByEmails = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const batchId = req.params.id;
  const { courseId } = req.body;

  const rows = normalizeAllotmentEntries(req.body);
  if (rows.length === 0) {
    return sendSuccess(res, []);
  }
  // Without a course id the order phase below is skipped entirely and everyone lands
  // enrolled with no order and no payment record — a silent failure that reads as a
  // clean run in the UI. Fail the request instead.
  if (!courseId) {
    throw new AppError('courseId is required to record allotment payments', 400);
  }

  const pending = rows.filter((r) => r.status === 'pending');

  // Resolve emails → user ids via auth service. Guarded: a user row with a null email
  // would throw here and take down the whole upload before anything is enrolled.
  const { data: users } = await authClient.post('/internal/users/by-emails', {
    emails: pending.map((r) => r.email),
  });
  const userMap = new Map(
    (Array.isArray(users) ? users : [])
      .filter((u) => u && typeof u.email === 'string')
      .map((u) => [u.email.toLowerCase(), u]),
  );

  // Phase 1 — enroll each user (batch_enrollment + access grant). This is one call per
  // user and already scales; only the order step (phase 2) is batched. Everything the
  // worker touches stays inside the try: mapWithConcurrency does not catch, so a throw
  // here rejects the whole request and loses the results for every other row too.
  await mapWithConcurrency(pending, BULK_CONCURRENCY, async (row) => {
    try {
      const user = userMap.get(row.email);
      if (!user) {
        row.status = 'user_not_found';
        row.message = 'No registered user with this email';
        return;
      }
      const { data } = await courseClient.post(`/internal/batches/${batchId}/enrollments`, { user_id: user.id });
      if (data.created === false) {
        row.status = 'already_enrolled';
        // Phase 2 only books orders for fresh enrollments, so a payment on a row for
        // someone already enrolled is dropped. Say so rather than reporting a clean skip.
        row.message = row.paymentId
          ? 'Already enrolled — the payment in this row was NOT recorded'
          : 'Already enrolled';
        return;
      }
      row.user = user;
      row.status = 'enrolled';
      await adminLogsService.logAction(
        adminId,
        'ADD_BATCH_ENROLLMENT',
        'batch_enrollment',
        String(data.id),
        { batchId, userId: user.id, amount: row.amount, paymentId: row.paymentId || null },
        req.ip,
      );
    } catch (err) {
      row.status = 'error';
      row.message = err?.response?.data?.error || err.message;
    }
  });

  // Phase 2 — create the "Purchased Course" orders for the newly-enrolled users via ONE
  // bulk call per chunk. order-service runs the same createManualOrder path per user at
  // bounded concurrency, so each order/payment/email is identical to a single allotment.
  // The user is already enrolled + granted access, so a failed order must NOT fail the
  // enrollment — it's surfaced via orderCreated:false + orderError instead of hidden.
  const toOrder = rows.filter((r) => r.status === 'enrolled' && r.user);
  for (let i = 0; i < toOrder.length; i += BULK_ORDER_CHUNK) {
    const chunk = toOrder.slice(i, i + BULK_ORDER_CHUNK);
    try {
      const { data: orderResults } = await orderClient.post(
        '/internal/orders/course-bulk',
        {
          entity_id: String(courseId),
          amount: 0,
          status: 'paid',
          // One settlement often backs several products — a membership and a course sold
          // as a bundle, or the same reference reused across two allotments. `payments` is
          // UNIQUE on (razorpay_payment_id, status), so without shared mode the second
          // order to carry a given reference dies on that index. Phase 1 has already
          // enrolled the learner by then, which is exactly how an allotment ends up with
          // access granted and no order. Shared mode keeps the real reference visible on
          // orders.rp_payment_id and gives the payments row a per-order capture ref.
          shared_payment_id: true,
          users: chunk.map((r) => ({
            user_id: r.user.id,
            buyer_name: r.user.name || null,
            buyer_email: r.user.email || null,
            buyer_mobile: r.user.phone || null,
            amount: r.amount,
            payment_id: r.paymentId || undefined,
          })),
        },
        { timeout: BULK_ORDER_TIMEOUT_MS },
      );
      const resultByUserId = new Map(
        (Array.isArray(orderResults) ? orderResults : []).map((or) => [String(or.user_id), or]),
      );
      for (const r of chunk) {
        const or = resultByUserId.get(String(r.user.id));
        if (or && or.ok === false) {
          r.orderCreated = false;
          r.orderError = or.error || 'Order could not be created';
        }
      }
    } catch (err) {
      const reason = err?.response?.data?.error || err.message;
      logger.warn(`[bulkEnroll] course-bulk order chunk failed (batch ${batchId}): ${reason}`);
      for (const r of chunk) {
        r.orderCreated = false;
        r.orderError = reason;
      }
    }
  }

  // One result per input row, in file order. `index`/`user` are internal; amount and
  // paymentId are echoed back so the admin panel can rebuild a corrected CSV of the
  // rows that failed without re-deriving them.
  const results = rows.map(({ index, user, amount, paymentId, ...rest }) => ({
    ...rest,
    amount: amount ?? null,
    paymentId: paymentId || '',
  }));
  sendSuccess(res, results);
});

/**
 * Bulk membership allotment — one order per allotted user.
 *
 * Mirrors the course-allotment flow (validated per-row entries, chunked bulk order
 * creation, never fail the whole upload for one row) with two deliberate differences:
 *
 *  - ORDER FIRST, then grant. `revokeMembership` matches on { user_id, order_id }, so a
 *    membership row with a null order_id can never be revoked when its order is
 *    refunded. Booking the order first lets the grant carry the real order id. It also
 *    gives clean per-row semantics: a duplicate payment id fails the order and the row
 *    is reported, instead of leaving access granted with no revenue record.
 *  - The orders are record-only (see emitMembershipRecordOnlyOutbox in order-service).
 *    Access is granted here, with the admin's chosen dates; the order records the money
 *    and triggers the membership email.
 *
 * Rows for users already active on this same plan are skipped entirely — no order, no
 * grant. Re-uploading the same file is therefore a no-op rather than a second set of
 * orders plus a membership row that expires the first. No tier-direction check is
 * applied: an admin allotting a different plan replaces whatever is active.
 */
const bulkGrantMembershipByEmails = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { membershipType, startsAt, expiresAt, planValidity, planPurchasedFormatted, planExpiryFormatted } = req.body;

  if (!membershipType || !startsAt || !expiresAt) {
    throw new AppError('membershipType, startsAt and expiresAt are required', 400);
  }

  // Membership orders are booked in shared-payment mode, so one settlement reference can
  // back every row and the form-level id applies to the whole upload.
  const rows = normalizeAllotmentEntries(req.body, { allowSharedPaymentId: true });
  if (rows.length === 0) {
    return sendSuccess(res, []);
  }

  // Validate the plan up front. entity_id is stored as the slug, and an unknown slug
  // would otherwise produce orders and membership rows pointing at nothing.
  const { data: planList } = await platformClient.get('/internal/platform/plans', { params: { limit: 200 } });
  const plans = Array.isArray(planList) ? planList : planList?.data ?? [];
  const plan = plans.find((p) => p?.slug && String(p.slug).toLowerCase() === String(membershipType).toLowerCase());
  if (!plan) {
    throw new AppError(`Unknown membership plan "${membershipType}"`, 400);
  }

  /**
   * Guard the backdated-allotment trap.
   *
   * `expiresAt` is derived from the admin's Date of Purchase plus the plan duration, so
   * backdating further than the plan lasts produces an expiry already in the past. That
   * grant lands dead on arrival: the order is booked and paid, but the membership row is
   * expired, so the user has no access — and because the duplicate guard below only sees
   * ACTIVE memberships, re-uploading the same file books a fresh order every time.
   *
   * Recording a genuinely lapsed historical purchase is legitimate, so this is an
   * explicit opt-in rather than a hard block. Without it, the request is rejected.
   */
  const expiresAtDate = new Date(expiresAt);
  const startsAtDate = new Date(startsAt);
  if (Number.isNaN(expiresAtDate.getTime()) || Number.isNaN(startsAtDate.getTime())) {
    throw new AppError('startsAt and expiresAt must be valid dates', 400);
  }
  const allotmentIsExpired = expiresAtDate <= new Date();
  if (allotmentIsExpired && req.body.allowExpired !== true) {
    throw new AppError(
      `This allotment expires ${expiresAtDate.toISOString().slice(0, 10)}, which has already passed — `
        + `every user would get a paid order but no access. Move the date of purchase forward, `
        + `or confirm the expired backfill to proceed.`,
      400,
    );
  }

  const pending = rows.filter((r) => r.status === 'pending');

  // Resolve emails → users. Guarded: a user row with a null email would throw here and
  // take down the whole upload before anything is allotted.
  const { data: users } = await authClient.post('/internal/users/by-emails', {
    emails: pending.map((r) => r.email),
  });
  const userMap = new Map(
    (Array.isArray(users) ? users : [])
      .filter((u) => u && typeof u.email === 'string')
      .map((u) => [u.email.toLowerCase(), u]),
  );

  for (const row of pending) {
    const user = userMap.get(row.email);
    if (!user) {
      row.status = 'user_not_found';
      row.message = 'No registered user with this email';
      continue;
    }
    row.user = user;
  }

  // Skip anyone already active on this same plan. One batched call — a row-by-row
  // lookup would be 1000 requests on a full upload.
  const resolved = rows.filter((r) => r.status === 'pending' && r.user);
  if (resolved.length > 0) {
    try {
      const { data: active } = await authClient.post('/internal/users/active-memberships', {
        userIds: resolved.map((r) => r.user.id),
      });
      const activeByUserId = new Map(
        (Array.isArray(active) ? active : []).map((m) => [String(m.user_id), m]),
      );
      for (const row of resolved) {
        const current = activeByUserId.get(String(row.user.id));
        if (!current) continue;
        const currentType = String(current.membership_type || '').toLowerCase();
        if (currentType === String(membershipType).toLowerCase()) {
          row.status = 'already_member';
          // Phase 2 books no order for a skipped row, so a payment in this row is
          // dropped. Say so rather than reporting a clean skip.
          row.message = row.paymentId
            ? `Already on ${plan.name} — the payment in this row was NOT recorded`
            : `Already on ${plan.name}`;
        } else {
          // Allotted anyway — admins are not subject to the tier-direction rule the
          // checkout path enforces. Named so the admin can see what was replaced.
          row.replacedPlan = current.membership_type;
        }
      }
    } catch (err) {
      // A failed guard must not fail the upload; worst case is the pre-existing
      // behaviour of re-granting an identical membership.
      logger.warn(`[bulkGrantMembership] active-membership lookup failed: ${err?.response?.data?.error || err.message}`);
    }
  }

  // Phase 1 — book the orders, in chunks, via ONE bulk call each. order-service runs the
  // same createManualOrder path per user at bounded concurrency, so every order/payment
  // row is identical to a single allotment.
  const toOrder = rows.filter((r) => r.status === 'pending' && r.user);
  for (let i = 0; i < toOrder.length; i += BULK_ORDER_CHUNK) {
    const chunk = toOrder.slice(i, i + BULK_ORDER_CHUNK);
    try {
      const { data: orderResults } = await orderClient.post(
        '/internal/orders/membership-bulk',
        {
          entity_id: plan.slug,
          amount: 0,
          status: 'paid',
          membership_starts_at: startsAt,
          membership_expires_at: expiresAt,
          // "Your membership is active" would be false for a lapsed backfill.
          skip_email: allotmentIsExpired,
          users: chunk.map((r) => ({
            user_id: r.user.id,
            buyer_name: r.user.name || null,
            buyer_email: r.user.email || null,
            buyer_mobile: r.user.phone || null,
            amount: r.amount,
            payment_id: r.paymentId || undefined,
          })),
        },
        { timeout: BULK_ORDER_TIMEOUT_MS },
      );
      const resultByUserId = new Map(
        (Array.isArray(orderResults) ? orderResults : []).map((or) => [String(or.user_id), or]),
      );
      for (const r of chunk) {
        const or = resultByUserId.get(String(r.user.id));
        if (or && or.ok) {
          r.orderId = or.order_id;
        } else {
          r.status = 'error';
          r.orderCreated = false;
          r.message = or?.error || 'Order could not be created — membership not allotted';
        }
      }
    } catch (err) {
      const reason = err?.response?.data?.error || err.message;
      logger.warn(`[bulkGrantMembership] membership-bulk order chunk failed (plan ${plan.slug}): ${reason}`);
      for (const r of chunk) {
        r.status = 'error';
        r.orderCreated = false;
        r.message = reason;
      }
    }
  }

  // Phase 2 — grant the membership for every row whose order was booked, carrying that
  // order id so a later refund can revoke the right membership row.
  const toGrant = rows.filter((r) => r.status === 'pending' && r.user && r.orderId);
  await mapWithConcurrency(toGrant, BULK_CONCURRENCY, async (row) => {
    const planJson = {
      price: String(row.amount ?? 0),
      plan_validity: planValidity ? String(planValidity) : undefined,
      plan_purchased: planPurchasedFormatted || startsAt,
      plan_expiry: planExpiryFormatted || expiresAt,
      payment_id: row.paymentId || row.orderId,
    };
    try {
      await authClient.post('/access/grant-membership', {
        userId: row.user.id,
        membershipType: plan.slug,
        startsAt,
        expiresAt,
        orderId: row.orderId,
        planJson,
      });
      // Distinct status so an already-expired backfill never reports as a clean grant.
      row.status = allotmentIsExpired ? 'granted_expired' : 'granted';
      await adminLogsService.logAction(
        adminId,
        'BULK_GRANT_MEMBERSHIP',
        'user_membership',
        String(row.user.id),
        { membershipType: plan.slug, startsAt, expiresAt, amount: row.amount, paymentId: row.paymentId || null, orderId: row.orderId },
        req.ip,
      );
    } catch (err) {
      // The order is already booked and paid. Flag it loudly: this user has a paid
      // order and no membership, which needs a manual fix.
      row.status = 'error';
      row.message = `Order ${row.orderId} was created but the membership could not be granted: ${err?.response?.data?.error || err.message}`;
    }
  });

  // One result per input row, in file order. `index`/`user` are internal; amount and
  // paymentId are echoed back so the admin panel can rebuild a corrected file of the
  // rows that failed without re-deriving them.
  const results = rows.map(({ index, user, amount, paymentId, ...rest }) => ({
    ...rest,
    amount: amount ?? null,
    paymentId: paymentId || '',
  }));
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

/**
 * Deallot a course from a user — the inverse of setUserCourseBatch.
 *
 * Clears every enrollment table for the pair (batch_enrollments, enrollments,
 * user_courses) via course-service's transactional unenrollUser, so access actually
 * stops rather than the user merely dropping out of a batch while keeping the grant.
 *
 * The order and payment rows are deliberately left untouched: they are the revenue
 * record and are never deleted to undo an allotment. The course therefore stays in the
 * user's purchase history and disappears only from their current allotments — which is
 * what getUserEnrollments reports via `has_access_grant`.
 */
const removeUserCourse = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const userId = Number(req.params.id);
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(userId) || userId <= 0) throw new AppError('Invalid user id', 400);
  if (!Number.isFinite(courseId) || courseId <= 0) throw new AppError('Invalid course id', 400);

  const { data } = await courseClient.post(`/internal/courses/${courseId}/unenroll`, {
    user_id: userId,
    // Record the removal (user_courses.revoked_at) rather than deleting the row. Only the
    // admin path does this; refunds keep the original delete. See unenrollUser.
    record_revocation: true,
  });
  await adminLogsService.logAction(
    adminId,
    'REMOVE_USER_COURSE',
    'user_course',
    `${userId}-${courseId}`,
    { userId, courseId, removed: data?.removed ?? null },
    req.ip,
  );
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

/**
 * Certificate download links.
 *
 * Thin proxies — the tables, the per-link cap and the serial allocation all live in
 * course-service, because the claim write has to bump the cap, draw from certificate_counter and
 * insert both ledger rows inside one transaction. Enforcing the cap from here would mean a
 * read-then-write across a network boundary, which is exactly the race the conditional UPDATE in
 * course-service exists to prevent.
 *
 * List endpoints are paginated, so their { success, data, meta } envelope is passed straight
 * through: courseClient only unwraps responses WITHOUT a `meta` key.
 */
const getCertificateLinks = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get('/internal/certificate-links', { params: req.query });
  res.json(data);
});

const getCertificateLink = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/certificate-links/${req.params.id}`);
  sendSuccess(res, data);
});

const postCertificateLink = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.post('/internal/certificate-links', {
    ...req.body,
    created_by: adminId,
  });
  await adminLogsService.logAction(
    adminId,
    'CREATE_CERTIFICATE_LINK',
    'certificate_link',
    String(data.id),
    { course_id: data.course_id, title: data.title },
    req.ip,
  );
  sendCreated(res, data);
});

const putCertificateLink = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const { data } = await courseClient.put(`/internal/certificate-links/${req.params.id}`, req.body);
  await adminLogsService.logAction(adminId, 'UPDATE_CERTIFICATE_LINK', 'certificate_link', req.params.id, {}, req.ip);
  sendSuccess(res, data);
});

const deleteCertificateLink = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await courseClient.delete(`/internal/certificate-links/${req.params.id}`);
  await adminLogsService.logAction(adminId, 'DELETE_CERTIFICATE_LINK', 'certificate_link', req.params.id, {}, req.ip);
  sendSuccess(res, { deleted: true });
});

const getCertificateLinkClaims = asyncHandler(async (req, res) => {
  const { data } = await courseClient.get(`/internal/certificate-links/${req.params.id}/claims`, {
    params: req.query,
  });
  res.json(data);
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

const deleteOrderPermanently = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  await orderClient.delete(`/internal/orders/${req.params.id}/permanent`);
  await adminLogsService.logAction(adminId, 'DELETE_ORDER_PERMANENT', 'order', req.params.id, {}, req.ip);
  sendNoContent(res);
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

const PABBLY_WEBHOOK_DEFAULT_PRIORITY = 10;
const PABBLY_WEBHOOK_CATCH_ALL_PRIORITY = 100000;

/**
 * Every course category id that currently exists, or null when course-service could not
 * be reached. Only used to normalise an "everything ticked" selection, so a failure here
 * degrades to storing the explicit list rather than failing the admin's save.
 */
async function fetchAllCourseCatIds() {
  try {
    const { data } = await courseClient.get('/internal/course-cats');
    const rows = Array.isArray(data) ? data : [];
    const ids = rows.map((c) => Number(c?.id)).filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids : null;
  } catch (err) {
    logger.warn(`[admin] could not load course cats to normalise Pabbly rule: ${err.message}`);
    return null;
  }
}

async function validatePabblyWebhookPayload(body) {
  const name = String(body.name || '').trim();
  if (!name) throw new AppError('Name is required', 400);

  const webhook_url = String(body.webhook_url || '').trim();
  if (!/^https:\/\//i.test(webhook_url)) {
    throw new AppError('A valid https:// webhook URL is required', 400);
  }

  let category_ids = body.category_ids;
  if (category_ids == null) category_ids = [];
  if (!Array.isArray(category_ids)) throw new AppError('category_ids must be an array', 400);
  category_ids = [
    ...new Set(category_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
  ];

  // Ticking every category means "fire for every course" to an admin, but stored as an
  // explicit list it does not behave that way: order-service matches by intersecting the
  // course's own category ids, so a course with no category linked matches nothing, and a
  // category created after this rule was saved is absent from the list. Collapse it to the
  // empty catch-all, which is the form that actually matches every course.
  if (category_ids.length > 0) {
    const allCatIds = await fetchAllCourseCatIds();
    if (allCatIds) {
      const selected = new Set(category_ids);
      if (allCatIds.every((id) => selected.has(id))) category_ids = [];
    }
  }

  // Priority isn't admin-facing — surfacing "first match wins, lower runs first" was
  // confusing more than it helped. Instead we derive it deterministically: rules that
  // name specific categories always run before a catch-all (empty category_ids), so a
  // course-specific automation never gets shadowed by a broad "matches everything" rule.
  const priority = category_ids.length === 0 ? PABBLY_WEBHOOK_CATCH_ALL_PRIORITY : PABBLY_WEBHOOK_DEFAULT_PRIORITY;

  const is_active = body.is_active != null ? !!body.is_active : true;

  return { name, webhook_url, category_ids, priority, is_active };
}

const getPabblyWebhooks = asyncHandler(async (req, res) => {
  const rows = await PabblyWebhook.findAll({ order: [['priority', 'ASC'], ['id', 'ASC']] });
  sendSuccess(res, rows.map((row) => row.get({ plain: true })));
});

const getPabblyWebhook = asyncHandler(async (req, res) => {
  const row = await PabblyWebhook.findByPk(req.params.id);
  if (!row) throw new AppError('Pabbly webhook not found', 404);
  sendSuccess(res, row.get({ plain: true }));
});

const postPabblyWebhook = asyncHandler(async (req, res) => {
  const payload = await validatePabblyWebhookPayload(req.body);
  const row = await PabblyWebhook.create(payload);
  sendCreated(res, row.get({ plain: true }));
});

const putPabblyWebhook = asyncHandler(async (req, res) => {
  const row = await PabblyWebhook.findByPk(req.params.id);
  if (!row) throw new AppError('Pabbly webhook not found', 404);
  const merged = { ...row.get({ plain: true }), ...req.body };
  const payload = await validatePabblyWebhookPayload(merged);
  await row.update(payload);
  await row.reload();
  sendSuccess(res, row.get({ plain: true }));
});

const deletePabblyWebhook = asyncHandler(async (req, res) => {
  const row = await PabblyWebhook.findByPk(req.params.id);
  if (!row) throw new AppError('Pabbly webhook not found', 404);
  await row.destroy();
  sendNoContent(res);
});

/**
 * Fires a sample course_purchase_success payload — identical in shape to what
 * order-service actually sends on a real purchase — at a given webhook_url, so an
 * admin can confirm a URL is correct (workflow active, reachable, parses fields as
 * expected) before relying on it. Works for an unsaved URL still being typed in the
 * create/edit form, not just a saved rule, so `webhook_url` is taken from the body
 * rather than looked up by id.
 */
const testPabblyWebhook = asyncHandler(async (req, res) => {
  const webhook_url = String(req.body.webhook_url || '').trim();
  if (!/^https:\/\//i.test(webhook_url)) {
    throw new AppError('A valid https:// webhook URL is required', 400);
  }

  const samplePayload = {
    event: 'course_purchase_success',
    orderId: 'TEST-' + Date.now(),
    customerName: 'Test User',
    customerEmail: 'test@example.com',
    customerPhone: '919876543210',
    courseId: 'TEST-COURSE',
    courseName: 'Test Course',
    courseCategory: 'Test Category',
    amount: 999,
    currency: 'INR',
    paymentId: 'TEST-PAYMENT-' + Date.now(),
    paymentStatus: 'SUCCESS',
    purchaseDate: new Date().toISOString(),
  };

  try {
    const response = await axios.post(webhook_url, samplePayload, {
      timeout: 15000,
      validateStatus: () => true, // report whatever Pabbly returns, never throw on non-2xx
    });
    sendSuccess(res, {
      success: response.status >= 200 && response.status < 300,
      status: response.status,
      response: response.data,
      payloadSent: samplePayload,
    });
  } catch (err) {
    sendSuccess(res, {
      success: false,
      status: null,
      response: err.message,
      payloadSent: samplePayload,
    });
  }
});

/** Consumed by order-service to resolve which webhook to fire on a course purchase. */
const getActivePabblyWebhooksInternal = asyncHandler(async (req, res) => {
  const rows = await PabblyWebhook.findAll({
    where: { is_active: true },
    order: [['priority', 'ASC'], ['id', 'ASC']],
  });
  sendSuccess(res, rows.map((row) => row.get({ plain: true })));
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
  getProducts: platformProxy((c) => c.get('/internal/platform/products').then((r) => ({ data: r.data }))),
  postProduct: platformProxy((c, req) => c.post('/internal/platform/products', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putProduct: platformProxy((c, req) => c.put(`/internal/platform/products/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteProduct: platformProxy((c, req) => c.delete(`/internal/platform/products/${req.params.id}`).then(() => ({ status: 204 }))),
  getProfessions: platformProxy((c) => c.get('/internal/platform/professions').then((r) => ({ data: r.data }))),
  getProfession: platformProxy((c, req) => c.get(`/internal/platform/professions/${req.params.id}`).then((r) => ({ data: r.data }))),
  postProfession: platformProxy((c, req) => c.post('/internal/platform/professions', req.body).then((r) => ({ data: r.data, status: 201 }))),
  putProfession: platformProxy((c, req) => c.put(`/internal/platform/professions/${req.params.id}`, req.body).then((r) => ({ data: r.data }))),
  deleteProfession: platformProxy((c, req) => c.delete(`/internal/platform/professions/${req.params.id}`).then(() => ({ status: 204 }))),
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
  listRedirects: platformProxy((c) => c.get('/internal/platform/redirects').then((r) => ({ data: r.data }))),
  postRedirect: platformProxy((c, req) =>
    c.post('/internal/platform/redirects', req.body).then((r) => ({ data: r.data, status: 201 }))
  ),
  putRedirect: platformProxy((c, req) =>
    c.put(`/internal/platform/redirects/${req.params.id}`, req.body).then((r) => ({ data: r.data }))
  ),
  deleteRedirect: platformProxy((c, req) =>
    c.delete(`/internal/platform/redirects/${req.params.id}`).then(() => ({ status: 204 }))
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
  getPlanCoursesMap: platformProxy((c) => c.get('/internal/platform/plan-courses/map').then((r) => ({ data: r.data }))),
  getCoursePlans: platformProxy((c, req) => c.get(`/internal/platform/courses/${req.params.courseId}/plans`).then((r) => ({ data: r.data }))),
  putCoursePlans: platformProxy((c, req) => c.put(`/internal/platform/courses/${req.params.courseId}/plans`, req.body).then((r) => ({ data: r.data }))),
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
    // Record the editor from the JWT-derived admin id, never from the client payload.
    const adminId = getAdminId(req);
    if (adminId) body.updated_by = adminId;
    else delete body.updated_by;

    return c.put(`/internal/platform/articles/${req.params.id}`, body).then((r) => ({ data: r.data }));
  }),
  deleteArticle: platformProxy((c, req) => c.delete(`/internal/platform/articles/${req.params.id}`).then(() => ({ status: 204 }))),
  deleteArticlePermanently: platformProxy((c, req) => c.delete(`/internal/platform/articles/${req.params.id}/permanent`).then(() => ({ status: 204 }))),
  restoreArticle: platformProxy((c, req) => c.post(`/internal/platform/articles/${req.params.id}/restore`).then(() => ({ status: 204 }))),
  getArticleEditLock: platformProxy((c, req) => c.get(`/internal/platform/articles/${req.params.id}/edit-lock`).then((r) => ({ data: r.data }))),
  // Lock identity always comes from the JWT-derived admin id, never from the client payload.
  acquireArticleEditLock: platformProxy((c, req) => {
    const adminId = getAdminId(req);
    if (!adminId) throw new AppError('Unable to resolve admin identity', 401);
    return c.post(`/internal/platform/articles/${req.params.id}/edit-lock`, { user_id: adminId }).then((r) => ({ data: r.data }));
  }),
  releaseArticleEditLock: platformProxy((c, req) => {
    const adminId = getAdminId(req);
    if (!adminId) throw new AppError('Unable to resolve admin identity', 401);
    return c.delete(`/internal/platform/articles/${req.params.id}/edit-lock`, { params: { user_id: adminId } }).then(() => ({ status: 204 }));
  }),
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
  const { data: payload } = await courseClient.get('/internal/affiliate/history', { params: req.query });
  if (payload && typeof payload === 'object' && payload.meta) {
    sendPaginated(res, { data: payload.data, meta: payload.meta });
    return;
  }
  sendSuccess(res, payload?.data ?? payload);
});

const exportAffiliateHistoryCsv = asyncHandler(async (req, res) => {
  const response = await courseClient.get('/internal/affiliate/history/export.csv', {
    params: req.query,
    responseType: 'stream',
    timeout: 120000,
  });
  res.setHeader('Content-Type', response.headers['content-type'] || 'text/csv; charset=utf-8');
  if (response.headers['content-disposition']) {
    res.setHeader('Content-Disposition', response.headers['content-disposition']);
  }
  response.data.pipe(res);
});

const getWithdrawalRequests = asyncHandler(async (req, res) => {
  const { data: payload } = await courseClient.get('/internal/affiliate/withdrawals', { params: req.query });
  if (payload && typeof payload === 'object' && payload.meta) {
    sendPaginated(res, { data: payload.data, meta: payload.meta });
    return;
  }
  sendSuccess(res, payload?.data ?? payload);
});

const exportWithdrawalRequestsCsv = asyncHandler(async (req, res) => {
  const response = await courseClient.get('/internal/affiliate/withdrawals/export.csv', {
    params: req.query,
    responseType: 'stream',
    timeout: 120000,
  });
  res.setHeader('Content-Type', response.headers['content-type'] || 'text/csv; charset=utf-8');
  if (response.headers['content-disposition']) {
    res.setHeader('Content-Disposition', response.headers['content-disposition']);
  }
  response.data.pipe(res);
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
  setUserCourseBatch,
  bulkAddBatchEnrollmentByEmails,
  bulkGrantMembershipByEmails,
  importUsersFromCsv,
  removeBatchEnrollment,
  removeUserCourse,
  getUserEnrollments,
  getUserMemberships,
  grantUserMembership,
  removeUserMembership,
  getUserDistinctStates,
  getBatches,
  addMaterial,
  getCourses,
  getCoursesForExport,
  deleteCourse,
  restoreCourse,
  deleteCoursePermanently,
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
  getCertificateLinks,
  getCertificateLink,
  postCertificateLink,
  putCertificateLink,
  deleteCertificateLink,
  getCertificateLinkClaims,
  getOrders,
  getOrderByOrderId,
  createOrder,
  applyCouponAdmin,
  updateOrder,
  refundOrder,
  deleteOrder,
  restoreOrder,
  deleteOrderPermanently,
  getCouponUsages,
  getCouponUsageSummary,
  getCoupons,
  getCoupon,
  postCoupon,
  putCoupon,
  deleteCoupon,
  checkCouponCodeExists,
  getPabblyWebhooks,
  getPabblyWebhook,
  postPabblyWebhook,
  putPabblyWebhook,
  deletePabblyWebhook,
  getActivePabblyWebhooksInternal,
  testPabblyWebhook,
  platform,
  uploadImage,
  uploadFile,
  getAffiliateHistory,
  exportAffiliateHistoryCsv,
  getWithdrawalRequests,
  exportWithdrawalRequestsCsv,
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
