const crypto = require('crypto');
const axios = require('axios');
const { sequelize, Order, Payment, OutboxEvent, Coupon, CouponUsage } = require('../models');
const { Op, QueryTypes } = require('sequelize');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getRazorpayInstance, getRazorpayConfig } = require('./payment.service');
const {
  AppError,
  logger,
  computeMembershipUpgradeCredit,
  parseTrashedMode,
  sqlDeletedAtIsNull,
  trashedSequelizeOptions,
  withTrashedWhere,
  whereHasClauses,
} = require('../../../../shared');

// GST rate applied on top of the post-discount price before charging via Razorpay
const GST_RATE = 0.18;

/** Trim + uppercase so order row matches `users.referral_code` lookups in course-service. */
function normalizeReferralForOrder(code) {
  if (code == null) return null;
  const s = String(code).trim();
  if (!s) return null;
  return s.toUpperCase();
}

function generateOrderId() {
  return 'ORD_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

/**
 * Retry a DB operation on transient InnoDB lock errors (deadlock / lock-wait
 * timeout). These always roll the whole transaction back, so re-running the
 * atomic `fn` is safe and cannot double-write. Hardens concurrent order creation
 * (bulk course allotment fires up to 10 order writes at once).
 */
async function withDeadlockRetry(fn, { attempts = 3, label = 'tx' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const code = err?.original?.code || err?.parent?.code || '';
      const transient =
        err?.name === 'SequelizeDeadlockError' ||
        code === 'ER_LOCK_DEADLOCK' ||
        code === 'ER_LOCK_WAIT_TIMEOUT';
      if (!transient || attempt >= attempts) throw err;
      logger.warn(`[orders] ${label}: transient lock error (attempt ${attempt}/${attempts}) — retrying: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 60 * attempt));
    }
  }
}

const ORDER_GATEWAY = {
  RAZORPAY: 'razorpay',
  ADMIN: 'admin',
  FREE: 'free',
};

function normalizeOrderGateway(value) {
  const g = String(value || '').toLowerCase().trim();
  if (g === 'razorpay' || g === 'rp') return ORDER_GATEWAY.RAZORPAY;
  if (g === 'admin' || g === 'manual') return ORDER_GATEWAY.ADMIN;
  if (g === 'free') return ORDER_GATEWAY.FREE;
  return '';
}

function resolveOrderGateway({ gateway, paymentId, amount, source } = {}) {
  if (Number(amount) === 0) return ORDER_GATEWAY.FREE;
  const normalized = normalizeOrderGateway(gateway);
  if (normalized) return normalized;
  const pid = normalizeAdminPaymentId(paymentId);
  if (pid && !pid.startsWith('manual:') && !pid.startsWith('free:')) {
    return ORDER_GATEWAY.RAZORPAY;
  }
  if (source === 'checkout' || source === 'webhook') return ORDER_GATEWAY.RAZORPAY;
  return ORDER_GATEWAY.ADMIN;
}

function formatPaymentMethodLabel(gateway, { amount, hasRazorpayPayment } = {}) {
  if (Number(amount) === 0 || normalizeOrderGateway(gateway) === ORDER_GATEWAY.FREE) {
    return 'Free';
  }
  const normalized = normalizeOrderGateway(gateway);
  if (normalized === ORDER_GATEWAY.ADMIN) return 'Admin';
  if (normalized === ORDER_GATEWAY.RAZORPAY) return 'Razorpay';
  if (hasRazorpayPayment) return 'Razorpay';
  return 'Razorpay';
}

// ─── Internal service helpers ─────────────────────────────────────────────────

async function fetchPlanDetails(entityId) {
  // The internal numeric endpoint only resolves numeric plan ids. Admin-granted
  // membership orders store the plan *slug* (e.g. "basic") as entity_id, so when
  // entity_id isn't numeric, resolve it via the public slug endpoint instead.
  const raw = entityId == null ? '' : String(entityId).trim();
  const isNumericId = /^\d+$/.test(raw);
  if (!isNumericId) {
    return fetchPlanBySlug(raw);
  }
  try {
    const { data } = await axios.get(
      `${config.platformServiceUrl}/internal/platform/plans/${entityId}`,
      {
        timeout: 8000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      }
    );
    return data.data !== undefined ? data.data : data;
  } catch (err) {
    logger.warn(`[orders] fetchPlanDetails failed for entity ${entityId}: ${err.message}`);
    return null;
  }
}

async function fetchPlanLinkedCourses(planId) {
  try {
    const { data } = await axios.get(
      `${config.platformServiceUrl}/internal/platform/plans/${planId}/linked-courses`,
      {
        timeout: 8000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      }
    );
    return parseApiResponse(data);
  } catch (err) {
    logger.warn(`[orders] failed to fetch linked courses for plan ${planId}: ${err.message}`);
    return { course_ids: [], course_cat_ids: [] };
  }
}

/** Course IDs the user already has access to (enrollment / batch / user_courses in course-service). Used to avoid duplicate grants when a plan bundles courses they already bought. */
async function fetchUserEnrolledCourseIds(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return new Set();
  try {
    const { data } = await axios.get(`${config.courseServiceUrl}/internal/users/${uid}/enrollments`, {
      timeout: 10000,
      headers: { 'x-internal-api-key': config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    const payload = parseApiResponse(data);
    const rows = Array.isArray(payload) ? payload : [];
    const set = new Set();
    for (const row of rows) {
      const cid = row && row.course_id != null ? Number(row.course_id) : NaN;
      if (Number.isFinite(cid) && cid > 0) set.add(cid);
    }
    return set;
  } catch (err) {
    logger.warn(`[orders] fetchUserEnrolledCourseIds failed for user ${uid}: ${err.message}`);
    return new Set();
  }
}

async function fetchUserActiveMembership(userId) {
  try {
    const { data } = await axios.get(
      `${config.authServiceUrl}/internal/users/${userId}/active-membership`,
      {
        timeout: 5000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      }
    );
    const payload = data.data !== undefined ? data.data : data;
    return payload || null;
  } catch (err) {
    logger.warn(`[orders] fetchUserActiveMembership failed for user ${userId}: ${err.message}`);
    return null;
  }
}

async function fetchPlanBySlug(slug) {
  try {
    const { data } = await axios.get(
      `${config.platformServiceUrl}/platform/plans/${encodeURIComponent(slug)}`,
      {
        timeout: 5000,
        validateStatus: (s) => s === 200,
      }
    );
    return data.data !== undefined ? data.data : data;
  } catch (err) {
    logger.warn(`[orders] fetchPlanBySlug failed for slug ${slug}: ${err.message}`);
    return null;
  }
}

/** Resolve display name for admin order rows (numeric plan id or public slug). */
async function resolveMembershipPlanDisplayName(entityId) {
  if (entityId == null || String(entityId).trim() === '') return null;
  const raw = String(entityId).trim();
  let plan = await fetchPlanDetails(raw);
  if (plan && plan.name) return plan.name;
  plan = await fetchPlanBySlug(raw);
  if (plan && plan.name) return plan.name;
  const numericId = Number(raw);
  if (Number.isFinite(numericId) && numericId > 0) {
    try {
      const { data: planRes } = await axios.get(
        `${config.platformServiceUrl}/internal/platform/plans/list-by-ids`,
        {
          params: { ids: String(numericId) },
          headers: { 'X-Internal-API-Key': config.internalApiKey },
          timeout: 8000,
          validateStatus: (s) => s === 200,
        }
      );
      const body = planRes && typeof planRes === 'object' && planRes.data !== undefined ? planRes.data : planRes;
      const plans = body && typeof body === 'object' && body.data !== undefined ? body.data : body;
      if (Array.isArray(plans) && plans.length) {
        const row = plans.find((r) => String(r.id) === String(numericId)) || plans[0];
        if (row && row.name) return row.name;
      }
    } catch (err) {
      logger.warn(`[orders] resolveMembershipPlanDisplayName list-by-ids: ${err.message}`);
    }
  }
  return null;
}

function buildMembershipPayload(order, plan, userContact = null, isManual = false) {
  const now = new Date();
  const payload = {
    userId: order.user_id,
    orderId: order.order_id,
    // Prefer the registered user email (from auth-service) over the order's buyer_email
    userEmail: userContact?.email || null,
    userName: userContact?.name || null,
    buyerEmail: order.buyer_email || null,
    buyerName: order.buyer_name || null,
    membershipPlanName: plan?.name || order.entity_id || null,
    // Admin/manual orders don't get an expiry shown in the confirmation email —
    // access itself still expires normally, this only affects the email payload below.
    isManualOrder: isManual,
  };

  if (plan && plan.is_lifetime) {
    const farFuture = new Date(now);
    farFuture.setFullYear(farFuture.getFullYear() + 10);
    payload.membershipType = plan.slug || 'lifetime';
    payload.startsAt = now.toISOString();
    payload.expiresAt = farFuture.toISOString();
  } else if (plan && plan.duration_days) {
    payload.membershipType = plan.slug || 'basic';
    payload.startsAt = now.toISOString();
    const expires = new Date(now.getTime() + plan.duration_days * 86400000);
    payload.expiresAt = expires.toISOString();
  } else {
    // Fallback when the plan couldn't be resolved or has no duration metadata.
    // Never fabricate a membership tier here — use the slug actually stored on the
    // order (admin grants store the plan slug as entity_id) so we don't silently
    // overwrite the granted plan with a bogus tier.
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 1);
    payload.membershipType = plan?.slug || order.entity_id;
    payload.startsAt = now.toISOString();
    payload.expiresAt = expires.toISOString();
  }

  const paidAmount = order.amount != null ? Number(order.amount) : null;
  payload.planJson = {
    price: paidAmount != null && !Number.isNaN(paidAmount)
      ? String(paidAmount)
      : (plan?.price != null ? String(plan.price) : undefined),
    plan_purchased: payload.startsAt,
    plan_expiry: payload.expiresAt,
    payment_id: order.order_id ? String(order.order_id) : undefined,
  };

  return payload;
}

async function resolveReferrer(userId, referralCode) {
  if (!referralCode) return null;
  try {
    const { data } = await axios.get(
      `${config.authServiceUrl}/internal/users/by-referral-code/${referralCode}`,
      { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 5000 }
    );
    const referrer = data.data || data;
    if (!referrer || String(referrer.id) === String(userId)) return null;
    const referredAt = referrer.referred_at ? new Date(referrer.referred_at) : null;
    if (referredAt) {
      const windowMs = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - referredAt.getTime() > windowMs) return null;
    }
    return referrer;
  } catch (err) {
    logger.warn(`[orders] resolveReferrer failed for code ${referralCode}: ${err.message}`);
    return null;
  }
}

async function fetchUserContact(userId) {
  try {
    const { data } = await axios.get(
      `${config.authServiceUrl}/internal/users/${userId}/contact`,
      { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 5000 }
    );
    return data.data || data;
  } catch (err) {
    logger.warn(`[orders] fetchUserContact failed for user ${userId}: ${err.message}`);
    return null;
  }
}

/**
 * A completed checkout is proof enough of the inbox — the receipt and access
 * emails land there. Marking the buyer verified here keeps a quick-registered
 * buyer (no-OTP checkout signup) from paying and then being bounced to the
 * /verify-email wall before they can see their purchase or open the course.
 *
 * Awaited by callers so the flag is set BEFORE the checkout verify response
 * returns (the web app refetches /auth/me right after). Never throws — a
 * failure here must not undo a payment that already went through; the buyer
 * can still verify by email as before.
 */
async function markBuyerEmailVerified(userId, orderId) {
  if (!userId) return;
  try {
    await axios.post(
      `${config.authServiceUrl}/internal/users/${userId}/mark-email-verified`,
      {},
      { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 5000 }
    );
  } catch (err) {
    logger.warn(
      `[orders] mark-email-verified failed for user ${userId} order=${orderId || '?'}: ${err.message}`
    );
  }
}

function normalizeOrderType(type) {
  if (!type || typeof type !== 'string') return '';
  return type.trim().toUpperCase();
}

function parseAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function parseApiResponse(response) {
  return response?.data !== undefined ? response.data : response;
}

async function fetchCourseAmount(entityId) {
  const { data, status } = await axios.get(`${config.courseServiceUrl}/internal/courses/${entityId}`, {
    timeout: 8000,
    headers: { 'x-internal-api-key': config.internalApiKey },
    validateStatus: (s) => s === 200,
  });
  if (status !== 200) throw new AppError('Course not found or price unavailable', 400);
  const payload = parseApiResponse(data);
  if (payload == null) throw new AppError('Course not found or price unavailable', 400);
  const rawSale = payload.sale_price;
  const hasSale = rawSale != null && rawSale !== '';
  const saleNum = hasSale ? parseAmount(rawSale) : null;
  const listNum = parseAmount(payload.price);
  const effective = hasSale && saleNum != null && Number.isFinite(saleNum) ? saleNum : listNum;
  if (!Number.isFinite(effective) || effective < 0) throw new AppError('Course price unavailable', 400);
  return effective;
}

/**
 * Campaign price for a course sold through a marketing landing page.
 *
 * The client only names the page (`marketingSlug`); the amount itself is read
 * server-side from course-service, so a tampered request can never set its own
 * price. Returns the page's sale price when the page is published, points at
 * this exact course, and carries a usable number — anything else returns null
 * and the checkout falls back to the course's own canonical price. Falling back
 * (rather than erroring) is deliberate: a stale or misconfigured landing page
 * should degrade to the regular price, not block the sale.
 */
async function resolveMarketingCampaignPrice(marketingSlug, courseId) {
  try {
    const { data, status } = await axios.get(
      `${config.courseServiceUrl}/internal/marketing-pages/by-slug/${encodeURIComponent(marketingSlug)}`,
      {
        timeout: 8000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200 || s === 404,
      }
    );
    if (status !== 200) {
      logger.warn(`[orders] marketing page "${marketingSlug}" not found — using course price`);
      return null;
    }
    const page = parseApiResponse(data);
    if (!page || !page.is_published) {
      logger.warn(`[orders] marketing page "${marketingSlug}" unpublished — using course price`);
      return null;
    }
    if (String(page.course_id) !== String(courseId)) {
      logger.warn(
        `[orders] marketing page "${marketingSlug}" sells course ${page.course_id}, not ${courseId} — using course price`
      );
      return null;
    }
    const rawSale = page.meta?.sale_price;
    if (rawSale == null || rawSale === '') return null;
    const sale = Number(rawSale);
    if (!Number.isFinite(sale) || sale < 0) {
      logger.warn(`[orders] marketing page "${marketingSlug}" has invalid sale_price "${rawSale}" — using course price`);
      return null;
    }
    return sale;
  } catch (err) {
    logger.warn(`[orders] resolveMarketingCampaignPrice("${marketingSlug}") failed: ${err.message}`);
    return null;
  }
}

/**
 * Ask course-service which batch this course purchase should enroll the user into.
 * Resolves synchronously at purchase creation so a batch lock-in decision is made BEFORE
 * new batches (added after purchase) are available. Returns null if the course has no batches yet.
 */
async function fetchPurchaseBatchId(courseId) {
  try {
    const { data } = await axios.get(
      `${config.courseServiceUrl}/internal/courses/${courseId}/select-purchase-batch`,
      {
        timeout: 8000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      }
    );
    const payload = parseApiResponse(data);
    return payload?.id ? Number(payload.id) : null;
  } catch (err) {
    logger.warn(`[orders] failed to resolve purchase batch for course ${courseId}: ${err.message}`);
    return null;
  }
}

/** Course-service batch row (GET /internal/batches/:id) for my-purchases enrichment. */
async function fetchBatchById(batchId) {
  try {
    const { data } = await axios.get(`${config.courseServiceUrl}/internal/batches/${batchId}`, {
      timeout: 8000,
      headers: { 'x-internal-api-key': config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    return parseApiResponse(data);
  } catch (err) {
    logger.warn(`[orders] failed to load batch ${batchId}: ${err.message}`);
    return null;
  }
}

/** DATEONLY compare in UTC — upcoming live batch vs in-progress vs ended. */
function computeLiveBatchPhase(batch) {
  if (!batch) return null;
  const today = new Date().toISOString().slice(0, 10);
  const sd = batch.start_date ? String(batch.start_date).slice(0, 10) : null;
  const ed = batch.end_date ? String(batch.end_date).slice(0, 10) : null;
  if (sd && sd > today) return 'upcoming';
  if (ed && ed < today) return 'completed';
  return 'live';
}

async function fetchMembershipAmount(entityId) {
  const { data, status } = await axios.get(`${config.platformServiceUrl}/internal/platform/plans/${entityId}`, {
    timeout: 8000,
    headers: { 'x-internal-api-key': config.internalApiKey },
    validateStatus: (s) => s === 200,
  });
  if (status !== 200) throw new AppError('Membership plan not found or price unavailable', 400);
  const payload = parseApiResponse(data);
  if (payload == null) throw new AppError('Membership plan not found or price unavailable', 400);
  const price = parseAmount(payload?.price);
  if (!Number.isFinite(price) || price < 0) throw new AppError('Membership price unavailable', 400);
  return price;
}

async function resolveAmountForEntity(type, entityId) {
  const typeUpper = normalizeOrderType(type);
  if (typeUpper === 'COURSE') return fetchCourseAmount(entityId);
  if (typeUpper === 'MEMBERSHIP') return fetchMembershipAmount(entityId);
  throw new AppError('Invalid type, expected COURSE or MEMBERSHIP', 400);
}

// ─── Coupon helpers ───────────────────────────────────────────────────────────

function isCouponTypeValid(coupon, typeUpper) {
  const discountOn = String(coupon.discount_on || '').trim().toLowerCase();
  if (!discountOn || discountOn === 'everything' || discountOn === 'all') return true;
  if (typeUpper === 'COURSE') return /course/i.test(discountOn);
  if (typeUpper === 'MEMBERSHIP') return /membership|plan/i.test(discountOn);
  return false;
}

function isDiscountOnAllowedForType(discountOn, typeUpper) {
  const d = String(discountOn || '').trim().toLowerCase();
  if (!d || d === 'everything' || d === 'all') return true;
  if (typeUpper === 'COURSE') return /course/i.test(d);
  if (typeUpper === 'MEMBERSHIP') return /membership|plan/i.test(d);
  return false;
}

function calculateDiscount(coupon, amount) {
  const isPct = String(coupon.type || '').trim().toLowerCase() === 'percentage';
  let value = Math.max(0, parseAmount(coupon.value));
  if (isPct) value = Math.min(100, value);
  const maxDiscount = parseAmount(coupon.max_discount);
  let discount = 0;
  if (isPct) {
    discount = (amount * value) / 100;
  } else {
    discount = value;
  }
  if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  return Math.max(0, Math.min(discount, amount));
}

function normalizeCouponCodeInput(code) {
  return String(code || '').trim().toLowerCase();
}

function isCouponPublished(status) {
  if (status == null || String(status).trim() === '') return false;
  const s = String(status).toLowerCase().trim();
  return s === 'publish' || s === 'published' || s === 'active';
}

/** Expire date is inclusive through end of that calendar day (UTC). */
function couponExpireEndInstant(expireDateRaw) {
  if (!expireDateRaw) return null;
  const d = new Date(expireDateRaw);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function getCouponDateState(coupon, now = new Date()) {
  const startDate = coupon.start_date ? new Date(coupon.start_date) : null;
  const expireEnd = couponExpireEndInstant(coupon.expire_date);
  const notYetActive =
    startDate && !Number.isNaN(startDate.getTime()) && now < startDate;
  const expired = expireEnd && now > expireEnd;
  const dateValid = !notYetActive && !expired;
  return { notYetActive, expired, dateValid };
}

async function findCouponByCode(rawCode) {
  const normalizedCode = normalizeCouponCodeInput(rawCode);
  if (!normalizedCode) return null;

  const coupon = await Coupon.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('code')), normalizedCode),
  });
  if (coupon) return coupon;

  // Legacy rows may have stray whitespace in code (fallback only).
  try {
    return await Coupon.findOne({
      where: sequelize.where(
        sequelize.fn('lower', sequelize.fn('trim', sequelize.col('code'))),
        normalizedCode,
      ),
    });
  } catch (err) {
    logger.warn(`[orders] findCouponByCode trim fallback failed: ${err.message}`);
    return null;
  }
}

function resolveCouponInactiveReason(coupon, amount, typeUpper) {
  const validType = isCouponTypeValid(coupon, typeUpper);
  if (!validType) return 'Coupon not applicable for selected type';

  const { notYetActive, expired } = getCouponDateState(coupon);
  if (notYetActive) return 'Coupon not active yet';
  if (expired) return 'Coupon has expired';

  const published = isCouponPublished(coupon.status);
  if (!published) return 'Coupon is not published';

  const meetsMinOrder = amount >= parseAmount(coupon.min_order);
  if (!meetsMinOrder) {
    return `Minimum order value ₹${parseAmount(coupon.min_order)} required`;
  }

  return null;
}

function couponInactiveReasonToMessage(inactiveReason) {
  switch (inactiveReason) {
    case 'Coupon has expired':
      return 'Coupon expired';
    case 'Coupon not active yet':
      return 'This coupon is not active yet';
    case 'Coupon is not published':
      return 'This coupon is no longer valid';
    case 'Coupon not applicable for selected type':
      return 'This coupon does not apply to this purchase';
    default:
      return inactiveReason || 'Coupon cannot be applied';
  }
}

function throwIfCouponCannotApply(result) {
  if (result.canApply) return;
  throw new AppError(result.inactiveReason || 'Coupon cannot be applied', 400);
}

function buildCouponResult(coupon, amount, typeUpper) {
  const inactiveReason = resolveCouponInactiveReason(coupon, amount, typeUpper);
  const discountAmount = calculateDiscount(coupon, amount);
  const finalAmount = Number((amount - discountAmount).toFixed(2));
  const canApply = !inactiveReason;

  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    type: coupon.type,
    value: parseAmount(coupon.value),
    min_order: parseAmount(coupon.min_order),
    max_discount: parseAmount(coupon.max_discount),
    discount_on: coupon.discount_on,
    start_date: coupon.start_date,
    expire_date: coupon.expire_date,
    status: coupon.status,
    created_at: coupon.created_at,
    amount,
    discountAmount,
    finalAmount,
    canApply,
    inactiveReason: inactiveReason ? couponInactiveReasonToMessage(inactiveReason) : null,
  };
}

/**
 * Validate a coupon server-side for a specific user + purchase.
 * Returns { coupon, discountAmount, finalAmount } or throws AppError.
 * Does NOT record usage — call recordCouponUsage() after order is created.
 */
async function validateCouponForOrder(userId, couponCode, amount, typeUpper) {
  const normalizedCode = normalizeCouponCodeInput(couponCode);
  if (!normalizedCode) return null;

  const coupon = await findCouponByCode(normalizedCode);
  if (!coupon) throw new AppError('Coupon not found', 404);

  const c = coupon.get({ plain: true });
  const result = buildCouponResult(c, amount, typeUpper);
  throwIfCouponCannotApply(result);

  // ── Usage limit check ────────────────────────────────────────────────────
  // Total usage across all users
  if (c.usage_limit != null) {
    const totalUsed = await CouponUsage.count({ where: { coupon_id: c.id } });
    if (totalUsed >= c.usage_limit) {
      throw new AppError('Coupon usage limit has been reached', 400);
    }
  }

  // Per-user limit (default 1: one-time use per user)
  const perUserLimit = c.per_user_limit ?? 1;
  if (userId != null && userId !== '') {
    const userUsed = await CouponUsage.count({ where: { coupon_id: c.id, user_id: userId } });
    if (userUsed >= perUserLimit) {
      throw new AppError('You have already used this coupon', 400);
    }
  }

  return { coupon, discountAmount: result.discountAmount, finalAmount: result.finalAmount };
}

async function recordCouponUsage(couponId, userId, orderId, transaction) {
  await CouponUsage.create(
    { coupon_id: couponId, user_id: userId, order_id: orderId },
    { transaction }
  );
}

/** When reusing the same checkout row, keep coupon_usages in sync with the new coupon (unique per coupon+order). */
async function syncCouponUsageForReusedOrder(orderPublicId, userId, previousCouponCode, couponResult, transaction) {
  const prev =
    previousCouponCode != null && String(previousCouponCode).trim() !== ''
      ? String(previousCouponCode).trim()
      : null;
  const next = couponResult ? String(couponResult.coupon.code).trim() : null;
  if (prev === next) return;
  await CouponUsage.destroy({ where: { order_id: orderPublicId }, transaction });
  if (couponResult) {
    await recordCouponUsage(couponResult.coupon.id, userId, orderPublicId, transaction);
  }
}

const PAID_ORDER_STATUSES = ['paid', 'completed'];

/** Outer row ref — Sequelize aliases Order model as `Order`, not table name `orders`. */
function orderCol(col) {
  return `\`Order\`.\`${col}\``;
}

/** SQL subquery: course validity for the current orders row (defaults to 1year). */
function courseValiditySqlForOrderRow() {
  return `COALESCE((
    SELECT c.validity FROM courses c
    WHERE c.id = CAST(${orderCol('entity_id')} AS UNSIGNED)
      AND ${sqlDeletedAtIsNull('c')}
    LIMIT 1
  ), '1year')`;
}

/** Paid course orders past the 1-year access window (non-lifetime courses only). */
function buildExpiredCourseAccessWhere() {
  const validity = courseValiditySqlForOrderRow();
  return {
    [Op.and]: [
      { type: 'course' },
      { status: { [Op.in]: PAID_ORDER_STATUSES } },
      sequelize.literal(`(${validity}) <> 'lifetime'`),
      sequelize.literal(`${orderCol('created_at')} <= DATE_SUB(NOW(), INTERVAL 1 YEAR)`),
    ],
  };
}

function mergeCourseAccessFilter(baseWhere, courseAccess) {
  const mode = courseAccess && String(courseAccess).toLowerCase().trim();
  if (mode !== 'active' && mode !== 'expired') return baseWhere;
  const expired = buildExpiredCourseAccessWhere();
  const clause = mode === 'expired' ? expired : { [Op.not]: expired };
  if (!whereHasClauses(baseWhere)) return clause;
  return { [Op.and]: [baseWhere, clause] };
}

function computeCourseAccessLabel(order, validityByCourseId) {
  if (order.type !== 'course') return null;
  const status = String(order.status || '').toLowerCase();
  if (!PAID_ORDER_STATUSES.includes(status)) return null;
  const cid = Number(order.entity_id);
  const validity =
    Number.isFinite(cid) && validityByCourseId.has(cid)
      ? validityByCourseId.get(cid)
      : '1year';
  if (validity === 'lifetime') return 'lifetime';
  const created = order.created_at ? new Date(order.created_at) : null;
  if (!created || Number.isNaN(created.getTime())) return 'active';
  const expiresAt = new Date(created);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  return new Date() > expiresAt ? 'expired' : 'active';
}

async function fetchCourseValiditiesMap(courseIds) {
  const ids = [...new Set(courseIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await sequelize.query(
    `SELECT id, validity FROM courses WHERE id IN (:ids) AND ${sqlDeletedAtIsNull()}`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  for (const r of rows) {
    map.set(Number(r.id), r.validity === 'lifetime' ? 'lifetime' : '1year');
  }
  return map;
}

/** Fetch the validity setting ('1year' | 'lifetime') for a course from the shared DB. */
async function fetchCourseValidity(courseId) {
  try {
    const rows = await sequelize.query(
      `SELECT validity FROM courses WHERE id = ? AND ${sqlDeletedAtIsNull()} LIMIT 1`,
      { replacements: [Number(courseId)], type: QueryTypes.SELECT }
    );
    return rows[0]?.validity ?? '1year';
  } catch (err) {
    // Column may not exist yet (pre-migration); default to '1year'
    logger.warn(`[orders] fetchCourseValidity failed for course ${courseId}: ${err.message}`);
    return '1year';
  }
}

/**
 * One COURSE_PURCHASED event.
 *
 * Even when the learner already has course access (so the worker skips re-granting /
 * extending it), this order still recorded a specific purchase batch — the batch
 * assignment must still be synced, or the order's batch_id is permanently orphaned
 * from what batch_enrollments actually reflects. Always emit the event; only the
 * access-grant side is conditional.
 */
async function emitCourseGrant(locked, t, { courseId, batchId, existingCourseIds, isMembershipLinked = false }) {
  const oid = locked.order_id;
  const cid = Number(courseId);
  const alreadyEnrolled = Number.isFinite(cid) && cid > 0 && existingCourseIds.has(cid);
  if (alreadyEnrolled) {
    logger.info(
      `[orders] user already has access to ${isMembershipLinked ? 'membership-linked ' : ''}course=${cid} order=${oid} — skipping access grant, batch will still be synced`
    );
  }
  const validity = await fetchCourseValidity(courseId);
  await OutboxEvent.create(
    {
      aggregate_type: 'order',
      aggregate_id: oid,
      event_type: 'COURSE_PURCHASED',
      payload: {
        userId: locked.user_id,
        orderId: oid,
        courseId: String(courseId),
        batchId: batchId ? Number(batchId) : null,
        ...(isMembershipLinked ? { isMembershipLinked: true } : {}),
        validity,
        skipAccessGrant: alreadyEnrolled,
      },
    },
    { transaction: t }
  );
}

/**
 * MEMBERSHIP_ACTIVATED plus one COURSE_PURCHASED per course the plan bundles.
 *
 * `planRef` is a plan id or slug. It is passed in rather than read off the order
 * because a payment-link order stores the *link* id in entity_id — see the orderView
 * note below for why that distinction matters.
 */
async function emitMembershipGrant(locked, t, { planRef, planSlug = null, existingCourseIds, isManual = false }) {
  const oid = locked.order_id;
  const plan = await fetchPlanDetails(planRef);
  // Fetch user's email from auth-service (authoritative source) rather than buyer_email on the order
  const userContact = locked.user_id ? await fetchUserContact(locked.user_id) : null;

  // When the plan can't be resolved, buildMembershipPayload falls back to the order's
  // entity_id for the membership tier. On a payment-link order that is the link id, so
  // the fallback would grant a membership named "42". Hand it the plan reference (the
  // slug snapshotted at checkout, when available) so even the degraded path is right.
  const needsPlanRefView = String(planRef) !== String(locked.entity_id);
  const orderView = needsPlanRefView
    ? {
        ...(typeof locked.get === 'function' ? locked.get({ plain: true }) : locked),
        entity_id: planSlug || String(planRef),
      }
    : locked;
  const payload = buildMembershipPayload(orderView, plan, userContact, isManual);

  await OutboxEvent.create(
    {
      aggregate_type: 'order',
      aggregate_id: oid,
      event_type: 'MEMBERSHIP_ACTIVATED',
      payload,
    },
    { transaction: t }
  );

  // Auto-assign courses linked to this membership plan.
  // planRef may be a slug (admin grants) — use the resolved plan's numeric id
  // since the linked-courses endpoint is numeric-only.
  const linkedCoursesPlanRef = plan?.id != null ? plan.id : planRef;
  const { course_ids = [], course_cat_ids = [] } = await fetchPlanLinkedCourses(linkedCoursesPlanRef);

  // 1. Handle explicit course IDs
  const courseSet = new Set(course_ids.map(Number).filter(Boolean));

  // 2. Resolve course IDs from categories
  if (course_cat_ids.length > 0) {
    try {
      const { data } = await axios.post(
        `${config.courseServiceUrl}/internal/courses/by-ids`,
        { cat_ids: course_cat_ids },
        {
          timeout: 10000,
          headers: { 'x-internal-api-key': config.internalApiKey },
          validateStatus: (s) => s === 200,
        }
      );
      const resolved = parseApiResponse(data);
      if (Array.isArray(resolved)) {
        resolved.forEach(c => courseSet.add(Number(c.id)));
      }
    } catch (err) {
      logger.warn(`[orders] failed to resolve course categories for plan ${planRef}: ${err.message}`);
    }
  }

  // 3. Emit COURSE_PURCHASED for each linked course (skip if user already has access — e.g. prior standalone purchase)
  for (const cid of courseSet) {
    // We resolve batch synchronously for EACH course to ensure consistency
    const batchId = await fetchPurchaseBatchId(cid);
    await emitCourseGrant(locked, t, {
      courseId: cid,
      batchId,
      existingCourseIds,
      isMembershipLinked: true,
    });
  }
}

/**
 * What a payment-link order promised the buyer, snapshotted onto the order at create
 * time: { product_type, product_id, batch_id, plan_slug, auto_enroll }.
 */
function parseFulfilment(locked) {
  const raw = locked.fulfilment;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      logger.warn(`[orders] unreadable fulfilment snapshot on order=${locked.order_id}`);
      return null;
    }
  }
  return typeof raw === 'object' ? raw : null;
}

/**
 * Payment-link fulfilment — grant whatever the link was selling.
 *
 * Every early return here leaves the order exactly where payment links used to end
 * up before they could fulfil themselves: paid, recorded, awaiting a manual grant.
 * That is a safe degradation, but a silent one, so each is logged at error level with
 * the order id — nothing here is expected in normal operation except 'custom' links.
 */
async function emitPaymentLinkGrant(locked, t, { existingCourseIds, isManual = false }) {
  const oid = locked.order_id;
  const snapshot = parseFulfilment(locked);
  const productType = snapshot?.product_type ? String(snapshot.product_type) : 'custom';

  // Money-only link (and every link created before this feature existed).
  if (productType === 'custom') return;

  if (snapshot.auto_enroll === false) {
    logger.info(`[orders] payment link order=${oid} has auto-enroll off — recording sale only`);
    return;
  }
  if (!locked.user_id) {
    logger.error(`[orders] payment link order=${oid} is paid but has no user — cannot grant ${productType}`);
    return;
  }
  if (!snapshot.product_id) {
    logger.error(`[orders] payment link order=${oid} has product_type=${productType} but no product_id`);
    return;
  }

  if (productType === 'course') {
    await emitCourseGrant(locked, t, {
      courseId: snapshot.product_id,
      batchId: snapshot.batch_id != null ? snapshot.batch_id : locked.batch_id,
      existingCourseIds,
    });
  } else if (productType === 'membership') {
    await emitMembershipGrant(locked, t, {
      planRef: snapshot.product_id,
      planSlug: snapshot.plan_slug || null,
      existingCourseIds,
      isManual,
    });
  } else {
    logger.error(`[orders] payment link order=${oid} has unknown product_type=${productType}`);
  }
}

/** Outbox: enrollment / membership + affiliate (only when order amount &gt; 0). */
async function emitPurchaseOutbox(locked, t, options = {}) {
  const skipAffiliate = options && options.skipAffiliate === true;
  const isManual = options && options.isManual === true;
  const oid = locked.order_id;
  const existingCourseIds = await fetchUserEnrolledCourseIds(locked.user_id);

  if (locked.type === 'course') {
    await emitCourseGrant(locked, t, {
      courseId: locked.entity_id,
      batchId: locked.batch_id,
      existingCourseIds,
    });
  } else if (locked.type === 'membership') {
    await emitMembershipGrant(locked, t, {
      planRef: locked.entity_id,
      existingCourseIds,
      isManual,
    });
  } else if (locked.type === 'payment_link') {
    await emitPaymentLinkGrant(locked, t, { existingCourseIds, isManual });
  }

  const orderAmt = parseFloat(locked.amount);
  if (!skipAffiliate && locked.affiliate && Number.isFinite(orderAmt) && orderAmt > 0) {
    await OutboxEvent.create(
      {
        aggregate_type: 'order',
        aggregate_id: oid,
        event_type: 'AFFILIATE_COMMISSION',
        payload: {
          userId: locked.user_id,
          orderId: oid,
          type: locked.type,
          entityId: locked.entity_id,
          amount: orderAmt,
          referralCode: locked.affiliate,
        },
      },
      { transaction: t }
    );
  }
}

/**
 * Outbox for a membership order that must NOT fulfil itself.
 *
 * Admin bulk allotment grants the membership directly, with the purchase date and
 * expiry the admin chose on the form. The order exists to record the money — so
 * running the normal `emitPurchaseOutbox` membership path would be actively wrong
 * twice over:
 *
 *  - MEMBERSHIP_ACTIVATED calls grant-membership a second time, and since
 *    buildMembershipPayload derives its dates from `now`, that grant expires the
 *    row the admin just created and replaces it with now-based dates.
 *  - The plan's linked courses fan out to one COURSE_PURCHASED per course (57 for
 *    Ultimate, so 59 events per order). Across a 1000-user upload that is ~59,000
 *    events and ~118,000 worker HTTP calls, for access the membership already
 *    confers lazily.
 *
 * So we emit exactly one MEMBERSHIP_ACTIVATED carrying `skipMembershipGrant`: the
 * worker sends the membership email and does not touch access. The membership's
 * real dates are passed through so the email matches what was actually granted
 * rather than the order's creation time.
 */
async function emitMembershipRecordOnlyOutbox(locked, t, { startsAt, expiresAt } = {}) {
  const plan = await fetchPlanDetails(locked.entity_id);
  const userContact = locked.user_id ? await fetchUserContact(locked.user_id) : null;
  const payload = buildMembershipPayload(locked, plan, userContact, true);

  payload.skipMembershipGrant = true;
  if (startsAt) payload.startsAt = startsAt;
  if (expiresAt) payload.expiresAt = expiresAt;

  await OutboxEvent.create(
    {
      aggregate_type: 'order',
      aggregate_id: locked.order_id,
      event_type: 'MEMBERSHIP_ACTIVATED',
      payload,
    },
    { transaction: t }
  );
}

// ─── Payment email outbox helper ──────────────────────────────────────────────

/** Course title for receipts/emails, or null when it can't be resolved. */
async function resolveCourseTitle(courseId) {
  try {
    const { data } = await axios.get(`${config.courseServiceUrl}/internal/courses/${courseId}`, {
      timeout: 5000,
      headers: { 'x-internal-api-key': config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    const payload = parseApiResponse(data);
    return payload?.title || payload?.name || null;
  } catch (err) {
    logger.warn(`[orders] course title fetch failed for course ${courseId}: ${err.message}`);
    return null;
  }
}

/** Title + category label for the course purchase webhook. Categories come back as
 * [{id, name, slug}, ...] from course-service; joined so a multi-category course
 * still yields one readable string instead of an array in the outgoing payload. */
async function resolveCourseDetails(courseId) {
  try {
    const { data } = await axios.get(`${config.courseServiceUrl}/internal/courses/${courseId}`, {
      timeout: 5000,
      headers: { 'x-internal-api-key': config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    const payload = parseApiResponse(data);
    const categories = Array.isArray(payload?.categories) ? payload.categories : [];
    const category = categories.map((c) => c?.name).filter(Boolean).join(', ') || null;
    const categoryIds = Array.isArray(payload?.course_cat_ids)
      ? payload.course_cat_ids.map(Number).filter((n) => Number.isFinite(n))
      : categories.map((c) => Number(c?.id)).filter((n) => Number.isFinite(n));
    return { title: payload?.title || payload?.name || null, category, categoryIds };
  } catch (err) {
    logger.warn(`[orders] course details fetch failed for course ${courseId}: ${err.message}`);
    return { title: null, category: null, categoryIds: [] };
  }
}

// ─── Pabbly webhook rules ──────────────────────────────────────────────────────
// Admin-managed, category-based automation triggers (source of truth: admin-service).
// Cached briefly in-memory so every course purchase doesn't round-trip to
// admin-service — a rule change takes up to PABBLY_RULES_CACHE_MS to take effect.
const PABBLY_RULES_CACHE_MS = 60 * 1000;
let pabblyRulesCache = { rules: null, fetchedAt: 0 };

async function fetchActivePabblyWebhookRules() {
  const now = Date.now();
  if (pabblyRulesCache.rules && now - pabblyRulesCache.fetchedAt < PABBLY_RULES_CACHE_MS) {
    return pabblyRulesCache.rules;
  }
  try {
    const { data } = await axios.get(`${config.adminServiceUrl}/internal/pabbly-webhooks/active`, {
      timeout: 5000,
      headers: { 'x-internal-api-key': config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    const rules = parseApiResponse(data);
    pabblyRulesCache = { rules: Array.isArray(rules) ? rules : [], fetchedAt: now };
  } catch (err) {
    logger.warn(`[orders] failed to fetch Pabbly webhook rules: ${err.message}`);
    // Keep serving the last known-good rules (if any) rather than firing nothing
    // on a transient admin-service blip.
    if (!pabblyRulesCache.rules) pabblyRulesCache = { rules: [], fetchedAt: now };
  }
  return pabblyRulesCache.rules;
}

/**
 * First rule (already priority-sorted) whose category_ids intersects the course's
 * categories, or whose category_ids is empty (a catch-all). Admin-configured rules
 * are the sole source of truth — if none are set up, or none match this course's
 * categories, we deliberately fire nothing rather than guessing a destination.
 */
async function resolvePabblyWebhookUrl(courseCategoryIds) {
  const rules = await fetchActivePabblyWebhookRules();
  const courseCatSet = new Set((courseCategoryIds || []).map(Number));
  for (const rule of rules) {
    const ruleCatIds = Array.isArray(rule.category_ids) ? rule.category_ids.map(Number) : [];
    if (ruleCatIds.length === 0) return rule.webhook_url; // catch-all
    if (ruleCatIds.some((id) => courseCatSet.has(id))) return rule.webhook_url;
  }
  return null; // rules exist, but none matched this course — deliberately don't fire
}

async function resolveItemName(order) {
  const t = String(order.type || '').toLowerCase();
  const eid = order.entity_id;
  if (t === 'course' && eid) {
    return (await resolveCourseTitle(eid)) || 'Course';
  }
  if (t === 'membership' && eid) {
    const name = await resolveMembershipPlanDisplayName(eid);
    return name || 'Membership Plan';
  }
  if (t === 'payment_link') {
    // A link that sells a course/plan should say so on the receipt — "Payment Link
    // Purchase" tells the buyer nothing about what they just bought.
    const snapshot = parseFulfilment(order);
    if (snapshot && snapshot.product_id) {
      const productType = String(snapshot.product_type || '');
      if (productType === 'course') {
        return (await resolveCourseTitle(snapshot.product_id)) || 'Course';
      }
      if (productType === 'membership') {
        const name =
          (await resolveMembershipPlanDisplayName(snapshot.product_id)) ||
          (snapshot.plan_slug ? await resolveMembershipPlanDisplayName(snapshot.plan_slug) : null);
        return name || 'Membership Plan';
      }
    }
    return 'Payment Link Purchase';
  }
  return 'Purchase';
}

async function resolveRecipientEmail(order) {
  if (order.buyer_email) return order.buyer_email;
  if (!order.user_id) return null;
  const contact = await fetchUserContact(order.user_id);
  return contact?.email || null;
}

async function emitPaymentEmailOutbox(locked, razorpayPaymentId, status, t, extra = {}) {
  const recipientEmail = await resolveRecipientEmail(locked);
  if (!recipientEmail) {
    logger.warn(`[orders] No email for payment notification, order=${locked.order_id}`);
    return;
  }
  const itemName = await resolveItemName(locked);
  const buyerName = locked.buyer_name || (locked.user_id ? (await fetchUserContact(locked.user_id))?.name : null) || null;

  await OutboxEvent.create(
    {
      aggregate_type: 'order',
      aggregate_id: locked.order_id,
      event_type: 'PAYMENT_EMAIL',
      payload: {
        to: recipientEmail,
        status,
        orderId: locked.order_id,
        type: locked.type,
        itemName,
        amount: parseFloat(locked.amount) || 0,
        currency: locked.currency || 'INR',
        buyerName: buyerName,
        couponCode: locked.coupon_code || null,
        couponDiscount: parseFloat(locked.coupon_discount) || 0,
        originalAmount: parseFloat(locked.original_amount) || null,
        paymentId: razorpayPaymentId || null,
        failReason: extra.failReason || null,
      },
    },
    { transaction: t }
  );
}

/**
 * Notifies the Pabbly automation (email sequences, CRM, etc.) on a successful course
 * purchase. Course orders only — a direct "buy this course" checkout, not a membership
 * activation or an admin-granted allotment (isManual). Emitted through the outbox like
 * every other side effect here so a Pabbly hiccup retries instead of getting lost, and
 * never blocks the payment transaction with an external HTTP call.
 */
async function emitCoursePurchaseWebhookOutbox(locked, razorpayPaymentId, t) {
  if (locked.type !== 'course') return;

  const { title: courseTitle, category: courseCategory, categoryIds } = await resolveCourseDetails(locked.entity_id);
  const webhookUrl = await resolvePabblyWebhookUrl(categoryIds);
  if (!webhookUrl) {
    logger.info(`[orders] no Pabbly webhook rule matched course=${locked.entity_id} order=${locked.order_id} — skipping`);
    return;
  }

  const userContact = locked.user_id ? await fetchUserContact(locked.user_id) : null;
  const customerEmail = locked.buyer_email || userContact?.email || null;
  const customerName = locked.buyer_name || userContact?.name || null;
  const customerPhone = locked.buyer_mobile || userContact?.phone || null;

  await OutboxEvent.create(
    {
      aggregate_type: 'order',
      aggregate_id: locked.order_id,
      event_type: 'COURSE_PURCHASE_WEBHOOK',
      payload: {
        webhookUrl,
        event: 'course_purchase_success',
        orderId: locked.order_id,
        customerName,
        customerEmail,
        customerPhone,
        courseId: String(locked.entity_id),
        courseName: courseTitle || 'Course',
        courseCategory,
        amount: parseFloat(locked.amount) || 0,
        currency: locked.currency || 'INR',
        paymentId: razorpayPaymentId || null,
        paymentStatus: 'SUCCESS',
        purchaseDate: new Date().toISOString(),
      },
    },
    { transaction: t }
  );
}

/**
 * Sent instead of emitPaymentEmailOutbox for orders an admin created/marked-paid
 * internally (no real payment behind them) — recipient should not see payment/amount details.
 */
async function emitCourseAccessEmailOutbox(locked, t) {
  const recipientEmail = await resolveRecipientEmail(locked);
  if (!recipientEmail) {
    logger.warn(`[orders] No email for access notification, order=${locked.order_id}`);
    return;
  }
  const itemName = await resolveItemName(locked);
  const buyerName = locked.buyer_name || (locked.user_id ? (await fetchUserContact(locked.user_id))?.name : null) || null;

  await OutboxEvent.create(
    {
      aggregate_type: 'order',
      aggregate_id: locked.order_id,
      event_type: 'COURSE_ACCESS_EMAIL',
      payload: {
        to: recipientEmail,
        orderId: locked.order_id,
        type: locked.type,
        itemName,
        buyerName,
      },
    },
    { transaction: t }
  );
}

// ─── captureRazorpayPayment ───────────────────────────────────────────────────
// Razorpay auto-refunds payments that are authorized but never captured (~1 day).
// We capture every payment explicitly here instead of relying on the account's
// dashboard-level auto-capture toggle, which can be silently turned off.
// Idempotent: a retry, or the payment.captured webhook, hits "already captured",
// which we treat as success.
async function captureRazorpayPayment(razorpayPaymentId, amountRupees, currency = 'INR') {
  // Only real Razorpay payments can be captured. Manual / free / admin references
  // (e.g. "manual:…", "free:…") are settled in their own flows and never go to
  // Razorpay — skip them here so we don't call the API with a non-payment id.
  const id = String(razorpayPaymentId || '');
  if (!id.startsWith('pay_')) {
    logger.info(`[orders] Skipping Razorpay capture — "${id}" is not a Razorpay payment id`);
    return;
  }

  const razorpay = await getRazorpayInstance();
  if (!razorpay) {
    throw new AppError('Payment gateway not configured — cannot capture payment', 500);
  }
  const amountPaise = Math.round(Number(amountRupees) * 100);
  try {
    await razorpay.payments.capture(razorpayPaymentId, amountPaise, currency || 'INR');
    logger.info(`[orders] Captured Razorpay payment ${razorpayPaymentId} — ${amountPaise} paise ${currency || 'INR'}`);
  } catch (err) {
    const desc = err?.error?.description || err?.description || err?.message || '';
    if (/already been captured|already captured/i.test(desc)) {
      logger.info(`[orders] Razorpay payment ${razorpayPaymentId} already captured — treating as success`);
      return;
    }
    logger.error(`[orders] Razorpay capture failed for ${razorpayPaymentId}: ${desc || 'unknown error'}`);
    throw new AppError(`Failed to capture payment: ${desc || 'gateway error'}`, 502);
  }
}

// ─── Guest checkout → real account ────────────────────────────────────────────
// Payment links can be paid without signing in. The checkout page signs the buyer
// up before it opens Razorpay, so orders normally arrive with a user_id already —
// but if that ever fails (session dropped, older client, admin-created order) a
// paid order would have nobody to enrol. These resolve that at payment time so
// "paid" and "enrolled" cannot come apart.

/** Internal id of an existing account for this email, or null. */
async function fetchUserIdByEmail(email) {
  try {
    const { data } = await axios.post(
      `${config.authServiceUrl}/internal/users/by-emails`,
      { emails: [email] },
      {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 10000,
        validateStatus: (s) => s === 200,
      }
    );
    const rows = parseApiResponse(data);
    const found = Array.isArray(rows) ? rows[0] : null;
    const id = found && found.id != null ? Number(found.id) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (err) {
    logger.warn(`[orders] user lookup by email failed: ${err.message}`);
    return null;
  }
}

/** Account for a buyer we've never seen. Returns the new user id, or null if we couldn't. */
async function createUserForBuyer({ email, name, phone }) {
  const attempt = async (payload) => {
    const { data } = await axios.post(`${config.authServiceUrl}/users`, payload, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const created = parseApiResponse(data);
    const id = created && created.id != null ? Number(created.id) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  };

  const fallbackName = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const base = { email, name: name || fallbackName || email, role: 'user' };

  try {
    return await attempt(phone ? { ...base, phone } : base);
  } catch (err) {
    if (!phone) {
      logger.error(`[orders] could not create account for buyer ${email}: ${err.message}`);
      return null;
    }
    // users.phone is uniquely indexed. A buyer paying under a new email but a phone
    // already on file would lose their enrolment to a duplicate-key error — the phone
    // is not worth that, so drop it and keep the account.
    logger.warn(`[orders] account create with phone failed for ${email} (${err.message}) — retrying without phone`);
    try {
      return await attempt(base);
    } catch (err2) {
      logger.error(`[orders] could not create account for buyer ${email}: ${err2.message}`);
      return null;
    }
  }
}

/**
 * The account an auto-created buyer has no password for yet. Fire-and-forget: a
 * failed email must never hold up a grant they have already paid for.
 */
function sendAccountSetupEmail(email) {
  axios
    .post(`${config.authServiceUrl}/auth/forgot-password`, { email }, { timeout: 10000 })
    .catch((err) => {
      logger.warn(`[orders] password-setup email failed for ${email}: ${err.message}`);
    });
}

/**
 * The user this order's access belongs to.
 *
 * `allowCreate` is off for money-only links: matching an existing account is always
 * useful (the purchase shows up in their history), but minting an account for someone
 * who bought a one-off item that grants nothing would just litter the user table.
 */
async function resolveBuyerUserId(order, { allowCreate }) {
  if (order.user_id) return Number(order.user_id);

  const email = String(order.buyer_email || '').trim().toLowerCase();
  if (!email) {
    logger.error(`[orders] order=${order.order_id} has no user and no buyer email — cannot resolve a buyer`);
    return null;
  }

  const existing = await fetchUserIdByEmail(email);
  if (existing) return existing;
  if (!allowCreate) return null;

  const created = await createUserForBuyer({
    email,
    name: order.buyer_name || null,
    phone: order.buyer_mobile || null,
  });
  if (created) {
    logger.info(`[orders] created account ${created} for guest checkout order=${order.order_id}`);
    sendAccountSetupEmail(email);
  }
  return created;
}

/** Whether this order's snapshot actually grants something a user is needed for. */
function orderNeedsBuyerAccount(order) {
  const snapshot = parseFulfilment(order);
  if (!snapshot) return false;
  const type = snapshot.product_type ? String(snapshot.product_type) : 'custom';
  return type !== 'custom' && snapshot.auto_enroll !== false && !!snapshot.product_id;
}

/** null when the order already has a user or none could be resolved. */
async function resolveMissingBuyerForPaymentLink(order) {
  if (order.user_id || String(order.type) !== 'payment_link') return null;
  return resolveBuyerUserId(order, { allowCreate: orderNeedsBuyerAccount(order) });
}

// ─── completePayment ──────────────────────────────────────────────────────────
// Called by both checkout verify and webhook. Uses SELECT … FOR UPDATE to
// prevent a double-payment race when verify + webhook arrive simultaneously.

async function completePayment(order, razorpayPaymentId, { signature = null, source = 'checkout' } = {}) {
  try {
    // Skip the capture/record work if the order is already paid (idempotent
    // re-entry from a concurrent verify + webhook). The transaction below
    // re-checks under lock; this only avoids a needless capture call.
    const current = await Order.findByPk(order.id);
    if (!current || current.status === 'paid') {
      return { alreadyPaid: true, message: 'Already paid' };
    }

    // Actually collect the money before granting access. Without this the payment
    // stays "authorized" and Razorpay auto-refunds it after ~1 day.
    await captureRazorpayPayment(razorpayPaymentId, current.amount, current.currency);

    // Outside the transaction on purpose — this can create an account in auth-service,
    // and that HTTP round trip should not be holding a row lock on the order.
    const resolvedBuyerId = await resolveMissingBuyerForPaymentLink(current);

    const outcome = await sequelize.transaction(async (t) => {
      const locked = await Order.findOne({
        where: { id: order.id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!locked || locked.status === 'paid') {
        return { alreadyPaid: true, message: 'Already paid' };
      }

      const paidPatch = { status: 'paid', gateway: ORDER_GATEWAY.RAZORPAY };
      if (resolvedBuyerId && !locked.user_id) paidPatch.user_id = resolvedBuyerId;
      await locked.update(paidPatch, { transaction: t });

      const existingPay = await Payment.findOne({
        where: { razorpay_payment_id: razorpayPaymentId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!existingPay) {
        await Payment.create(
          {
            order_id: locked.id,
            razorpay_payment_id: razorpayPaymentId,
            razorpay_signature: signature,
            amount: locked.amount,
            status: 'captured',
            source,
          },
          { transaction: t }
        );
      } else {
        if (String(existingPay.order_id) !== String(locked.id)) {
          throw new AppError('Payment is associated with another order', 409);
        }
        if (existingPay.status !== 'captured') {
          await existingPay.update(
            {
              status: 'captured',
              razorpay_signature: signature ?? existingPay.razorpay_signature,
              amount: locked.amount,
              source,
            },
            { transaction: t }
          );
        }
      }

      await emitPurchaseOutbox(locked, t);
      await emitPaymentEmailOutbox(locked, razorpayPaymentId, 'success', t);
      await emitCoursePurchaseWebhookOutbox(locked, razorpayPaymentId, t);
      return { verified: true };
    });

    // Awaited so checkout's verify response returns AFTER the flag is set — the web
    // app refetches /auth/me immediately after and must not see a stale "unverified".
    if (outcome && outcome.verified) {
      await markBuyerEmailVerified(resolvedBuyerId || current.user_id, current.order_id);
    }
    return outcome;
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      const fresh = await Order.findByPk(order.id);
      if (fresh && fresh.status === 'paid') {
        return { verified: true, alreadyPaid: true };
      }
    }
    throw err;
  }
}

/**
 * How recently a PAID order for the same course refuses a fresh paid checkout.
 *
 * Deliberately short. A repurchase weeks or months later is legitimate here — the same
 * course is re-run as a new cohort, and learners do buy a later run — so the guard only
 * covers the double-submit / double-payment window (a customer clicking Buy Now twice, or
 * paying again because the first success screen never loaded). Widening this would start
 * rejecting real payments: of the 231 historical duplicate pairs, only 13 were inside
 * 30 minutes while 146 were 30 days to 12 months apart.
 */
const DUPLICATE_PAID_ORDER_WINDOW_MS = 15 * 60 * 1000;

/**
 * The live order (if any) by which this user already bought this exact course, plus whether
 * the access it granted is still open.
 *
 * `Order` is paranoid, so an order moved to trash does NOT count — deleting a test order
 * deliberately frees the learner to register again.
 *
 * Access window follows the same rule as listMyPurchases: `user_courses` is the live source
 * of truth (no row = no access, expires_at NULL = lifetime, otherwise compare to now), and a
 * legacy migrated order carrying wp_post_status='publish' is authoritative-active on its own.
 *
 * Returns null when the user never bought this course — note that membership-derived access
 * writes no course order, so a membership learner buying the course standalone is never
 * caught here.
 */
async function findExistingCoursePurchase(userId, entityIdStr) {
  const uid = Number(userId);
  const cid = Number(entityIdStr);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(cid) || cid <= 0) return null;

  const existing = await Order.findOne({
    where: {
      user_id: uid,
      type: 'course',
      entity_id: String(entityIdStr),
      [Op.or]: [
        { status: { [Op.in]: PAID_ORDER_STATUSES } },
        { wp_post_status: 'publish' },
      ],
    },
    order: [['created_at', 'DESC']],
  });
  if (!existing) return null;
  const order = existing.get({ plain: true });

  let grantRow = null;
  try {
    const rows = await sequelize.query(
      `SELECT expires_at FROM user_courses WHERE user_id = :uid AND course_id = :cid LIMIT 1`,
      { replacements: { uid, cid }, type: QueryTypes.SELECT }
    );
    grantRow = rows[0] || null;
  } catch (err) {
    // Never let an access lookup failure block a checkout — fall through as "no grant",
    // which only ever makes the guard MORE permissive.
    logger.warn(`[orders] access-window lookup failed for user ${uid} course ${cid}: ${err.message}`);
  }

  const grantExpiresAt = grantRow ? grantRow.expires_at ?? null : null;
  const grantActive = !!grantRow && (!grantExpiresAt || new Date(grantExpiresAt) > new Date());
  const accessActive = grantActive || order.wp_post_status === 'publish';

  return { order, accessActive, accessExpiresAt: grantActive ? grantExpiresAt : null };
}

function formatAccessExpiryLabel(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
  });
}

// ─── createOrder ─────────────────────────────────────────────────────────────
// SECURITY: Always fetches price from backend. Client-supplied `amount` is IGNORED.
// Coupon is validated server-side and discount recorded on the order row.
// IDEMPOTENCY: Reuses a single pending/failed checkout row per (user, type, entity) so
// repeat /orders/create calls do not insert duplicate orders for the same purchase intent.

async function createOrder(userId, { type, entityId, couponCode, referralCode, currency = 'INR', utm, buyer_name, buyer_email, buyer_mobile, marketingSlug }) {
  const typeUpper = normalizeOrderType(type);

  // 1. Fetch canonical price from the owning service — never trust client
  let originalAmount = await resolveAmountForEntity(typeUpper, entityId);

  // 1a. Marketing landing pages can sell the course at a campaign price. Still
  // server-canonical — the client only names the page, the price is read from
  // course-service and only honoured when the published page sells THIS course.
  if (typeUpper === 'COURSE' && marketingSlug && String(marketingSlug).trim()) {
    const campaignPrice = await resolveMarketingCampaignPrice(String(marketingSlug).trim(), entityId);
    if (campaignPrice != null) originalAmount = campaignPrice;
  }

  // 1b. Membership upgrade guard — enforce one-active-membership and upgrade-only direction
  let upgradeDeduction = 0;
  if (typeUpper === 'MEMBERSHIP') {
    const [newPlan, activeMembership] = await Promise.all([
      fetchPlanDetails(entityId),
      fetchUserActiveMembership(userId),
    ]);

    if (activeMembership) {
      const activePlan = await fetchPlanBySlug(activeMembership.membership_type);
      const activeTierRank = activePlan ? Number(activePlan.tier_rank ?? 0) : 0;
      const newTierRank = newPlan ? Number(newPlan.tier_rank ?? 0) : 0;

      if (newTierRank <= activeTierRank) {
        const activeName = activePlan ? activePlan.name : activeMembership.membership_type;
        const newName = newPlan ? newPlan.name : String(entityId);
        throw new AppError(
          `You already have an active "${activeName}" membership. You can only upgrade to a higher tier, not purchase "${newName}".`,
          400
        );
      }

      // Lifetime-to-lifetime: cannot auto-process — admin must handle
      if (activePlan && activePlan.is_lifetime && newPlan && newPlan.is_lifetime) {
        throw new AppError(
          'Upgrading from a lifetime plan to another lifetime plan cannot be processed automatically. Please contact support.',
          400
        );
      }

      // Pro-rated deduction: unused value of current plan (capped at one term; see shared helper)
      if (
        activePlan &&
        !activePlan.is_lifetime &&
        activePlan.duration_days &&
        activePlan.duration_days > 0
      ) {
        const { upgradeDeduction: credit } = computeMembershipUpgradeCredit({
          planPrice: activePlan.price,
          durationDays: activePlan.duration_days,
          expiresAt: activeMembership.expires_at,
          now: new Date(),
          isLifetime: !!activePlan.is_lifetime,
        });
        upgradeDeduction = credit;
      }
    }
  }

  // Adjusted base amount after pro-rated upgrade deduction (floored at 0)
  const adjustedAmount = Number(Math.max(0, originalAmount - upgradeDeduction).toFixed(2));

  // 2. Validate coupon (throws on invalid/expired/over-limit) — applied on adjusted amount
  let couponResult = null;
  if (couponCode && String(couponCode).trim()) {
    couponResult = await validateCouponForOrder(userId, couponCode, adjustedAmount, typeUpper);
  }

  const discountAmount = couponResult ? couponResult.discountAmount : 0;
  const afterDiscount = couponResult ? couponResult.finalAmount : adjustedAmount;

  // 3. Apply 18% GST on the post-discount amount
  const gstAmount = Number((afterDiscount * GST_RATE).toFixed(2));
  const grandTotal = Number((afterDiscount + gstAmount).toFixed(2));

  // 3b. Already-owned guard for COURSE (MEMBERSHIP has its own upgrade guard in 1b above).
  //
  // The Redis lock below only holds for the duration of one request — it is deleted the
  // moment the order succeeds — so it stops concurrent submits but not a second click a
  // few seconds later. And the pending/failed row-reuse further down cannot see an already
  // PAID order, so every repeat click used to insert a fresh paid row: one learner, many
  // orders. That is the whole "17 enrolled / 18 orders" gap (all Rs.0 registrations).
  //
  // Two different situations, deliberately handled differently:
  //  - Nothing to charge (free course / 100% coupon) and access still open → there is
  //    nothing to create, so hand back the order the learner already has. Idempotent, and
  //    the caller cannot tell it apart from a fresh free registration.
  //  - Real money → only the double-payment window is refused (see the constant). Access
  //    being active is NOT enough to reject a paid checkout.
  //
  // Expired access always falls through to a normal new order in both cases: that is a
  // genuine renewal and must keep working.
  if (typeUpper === 'COURSE') {
    const owned = await findExistingCoursePurchase(userId, entityId);
    if (owned) {
      if (grandTotal <= 0 && owned.accessActive) {
        const contact = await fetchUserContact(userId);
        logger.info(
          `[orders] free re-registration ignored for user ${userId} course ${entityId} — already held by order ${owned.order.order_id}`
        );
        // Still a completed checkout from the caller's perspective — the success
        // page is gated on a verified email, so flip the flag here too.
        await markBuyerEmailVerified(userId, owned.order.order_id);
        return {
          orderId: owned.order.order_id,
          free: true,
          paid: true,
          // Lets a caller distinguish "you already had this" from a brand-new free
          // registration. Existing callers that only check `free && paid` are unaffected.
          alreadyEnrolled: true,
          accessExpiresAt: owned.accessExpiresAt
            ? new Date(owned.accessExpiresAt).toISOString()
            : null,
          razorpayOrderId: null,
          amount: 0,
          originalAmount: Math.round(originalAmount * 100),
          upgradeAdjustment: 0,
          adjustedMembershipAmount: Math.round(adjustedAmount * 100),
          discountAmount: Math.round(discountAmount * 100),
          gstAmount: Math.round(gstAmount * 100),
          grandTotal: 0,
          currency,
          key: null,
          prefill: {
            name: contact?.name || '',
            email: contact?.email || '',
            contact: contact?.phone || '',
          },
        };
      }

      if (grandTotal > 0) {
        const placedAt = new Date(owned.order.created_at).getTime();
        const ageMs = Number.isFinite(placedAt) ? Date.now() - placedAt : Infinity;
        if (ageMs >= 0 && ageMs < DUPLICATE_PAID_ORDER_WINDOW_MS) {
          const expiryLabel = formatAccessExpiryLabel(owned.accessExpiresAt);
          throw new AppError(
            `Your payment for this course has already gone through (order ${owned.order.order_id}). ` +
              (expiryLabel
                ? `Your access is valid until ${expiryLabel}. `
                : 'The course is already available in My Courses. ') +
              'Please wait a few minutes before trying again, or contact support if you cannot see it.',
            409
          );
        }
      }
    }
  }

  // 4. Guard: idempotency lock per (user, type, entity) — prevents race-created duplicates
  const lockKey = `order:lock:${userId}:${typeUpper}:${entityId}`;
  const redis = await getRedis();
  const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
  if (!gotLock) throw new AppError('Duplicate order in progress', 429);

  const typeLower = typeUpper.toLowerCase();
  const entityIdStr = String(entityId);

  let resolvedBatchId = null;
  if (typeUpper === 'COURSE') {
    resolvedBatchId = await fetchPurchaseBatchId(entityId);
  }
                          
  try {
    if (grandTotal <= 0) {
      const contact = await fetchUserContact(userId);
      let outOrderId;
      await sequelize.transaction(async (t) => {
        let row = await Order.findOne({
          where: {
            user_id: userId,
            type: typeLower,
            entity_id: entityIdStr,
            status: { [Op.in]: ['pending', 'failed'] },
          },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        let reused = false;
        if (row) {
          reused = true;
          await syncCouponUsageForReusedOrder(row.order_id, userId, row.coupon_code, couponResult, t);
          await row.update(
            {
              status: 'pending',
              batch_id: resolvedBatchId,
              original_amount: originalAmount,
              coupon_code: couponResult ? couponResult.coupon.code : null,
              coupon_discount: discountAmount,
              amount: grandTotal,
              currency,
              affiliate: normalizeReferralForOrder(referralCode),
              gateway: 'free',
              utm: utm !== undefined ? utm : row.utm,
              buyer_name: buyer_name != null ? buyer_name : row.buyer_name,
              buyer_email: buyer_email != null ? buyer_email : row.buyer_email,
              buyer_mobile: buyer_mobile != null ? buyer_mobile : row.buyer_mobile,
            },
            { transaction: t }
          );
          row = await Order.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
          outOrderId = row.order_id;
        } else {
          const oid = generateOrderId();
          outOrderId = oid;
          row = await Order.create(
            {
              order_id: oid,
              user_id: userId,
              type: typeLower,
              entity_id: entityIdStr,
              batch_id: resolvedBatchId,
              original_amount: originalAmount,
              coupon_code: couponResult ? couponResult.coupon.code : null,
              coupon_discount: discountAmount,
              amount: grandTotal,
              currency,
              status: 'pending',
              affiliate: normalizeReferralForOrder(referralCode),
              gateway: 'free',
              utm,
              buyer_name,
              buyer_email,
              buyer_mobile,
            },
            { transaction: t }
          );
        }
        const locked = await Order.findOne({
          where: { id: row.id },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (!locked) throw new AppError('Order not found after create', 500);
        await locked.update({ status: 'paid' }, { transaction: t });
        const freeRef = `free:${locked.order_id}`;
        await Payment.findOrCreate({
          where: { order_id: locked.id, source: 'free' },
          defaults: {
            order_id: locked.id,
            razorpay_payment_id: freeRef,
            razorpay_signature: null,
            amount: locked.amount,
            status: 'captured',
            source: 'free',
          },
          transaction: t,
        });
        await emitPurchaseOutbox(locked, t);
        await emitPaymentEmailOutbox(locked, `free:${locked.order_id}`, 'success', t);
        await emitCoursePurchaseWebhookOutbox(locked, `free:${locked.order_id}`, t);
        if (couponResult && !reused) {
          await recordCouponUsage(couponResult.coupon.id, userId, locked.order_id, t);
        }
      });
      await redis.del(lockKey);
      // A free checkout fulfils immediately and never passes through completePayment,
      // so the quick-registered buyer is verified here instead.
      await markBuyerEmailVerified(userId, outOrderId);
      return {
        orderId: outOrderId,
        free: true,
        paid: true,
        razorpayOrderId: null,
        amount: 0,
        originalAmount: Math.round(originalAmount * 100),
        upgradeAdjustment: Math.round(upgradeDeduction * 100),
        adjustedMembershipAmount: Math.round(adjustedAmount * 100),
        discountAmount: Math.round(discountAmount * 100),
        gstAmount: Math.round(gstAmount * 100),
        grandTotal: 0,
        currency,
        key: null,
        prefill: {
          name: contact?.name || '',
          email: contact?.email || '',
          contact: contact?.phone || '',
        },
      };
    }

    const razorpay = await getRazorpayInstance();
    if (!razorpay) throw new AppError('Payment not configured', 503);

    const amountPaise = Math.round(grandTotal * 100);
    let order;
    let isReuse = false;

    await sequelize.transaction(async (t) => {
      order = await Order.findOne({
        where: {
          user_id: userId,
          type: typeLower,
          entity_id: entityIdStr,
          status: { [Op.in]: ['pending', 'failed'] },
        },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (order) {
        isReuse = true;
        await syncCouponUsageForReusedOrder(order.order_id, userId, order.coupon_code, couponResult, t);
        await order.update(
          {
            status: 'pending',
            batch_id: resolvedBatchId != null ? resolvedBatchId : order.batch_id,
            original_amount: originalAmount,
            coupon_code: couponResult ? couponResult.coupon.code : null,
            coupon_discount: discountAmount,
            amount: grandTotal,
            currency,
            affiliate: normalizeReferralForOrder(referralCode),
            utm: utm !== undefined ? utm : order.utm,
            gateway: ORDER_GATEWAY.RAZORPAY,
            buyer_name: buyer_name != null ? buyer_name : order.buyer_name,
            buyer_email: buyer_email != null ? buyer_email : order.buyer_email,
            buyer_mobile: buyer_mobile != null ? buyer_mobile : order.buyer_mobile,
          },
          { transaction: t }
        );
        order = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      } else {
        const oid = generateOrderId();
        order = await Order.create(
          {
            order_id: oid,
            user_id: userId,
            type: typeLower,
            entity_id: entityIdStr,
            batch_id: resolvedBatchId,
            original_amount: originalAmount,
            coupon_code: couponResult ? couponResult.coupon.code : null,
            coupon_discount: discountAmount,
            amount: grandTotal,
            currency,
            status: 'pending',
            affiliate: normalizeReferralForOrder(referralCode),
            utm,
            gateway: ORDER_GATEWAY.RAZORPAY,
            buyer_name,
            buyer_email,
            buyer_mobile,
          },
          { transaction: t }
        );
      }
    });

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency,
      receipt: order.order_id,
      notes: {
        orderId: order.order_id,
        userId: String(userId),
        type: typeUpper,
        entityId: entityIdStr,
      },
    });

    await order.update({ razorpay_order_id: rpOrder.id });

    if (couponResult && !isReuse) {
      await recordCouponUsage(couponResult.coupon.id, userId, order.order_id, null);
    }

    await redis.del(lockKey);

    const rpConfig = await getRazorpayConfig();
    const contact = await fetchUserContact(userId);

    return {
      orderId: order.order_id,
      free: false,
      paid: false,
      razorpayOrderId: rpOrder.id,
      amount: amountPaise,
      originalAmount: Math.round(originalAmount * 100),
      upgradeAdjustment: Math.round(upgradeDeduction * 100),
      adjustedMembershipAmount: Math.round(adjustedAmount * 100),
      discountAmount: Math.round(discountAmount * 100),
      gstAmount: Math.round(gstAmount * 100),
      grandTotal: Math.round(grandTotal * 100),
      currency,
      key: rpConfig?.key_id,
      prefill: {
        name: contact?.name || '',
        email: contact?.email || '',
        contact: contact?.phone || '',
      },
    };
  } catch (err) {
    await redis.del(lockKey).catch(() => { });
    throw err;
  }
}

// ─── Payment link checkout (amount from admin-service; guest OK) ─────────────

async function fetchPaymentLinkCheckoutContext(paymentLinkId) {
  try {
    const { data: body, status } = await axios.get(
      `${config.adminServiceUrl}/internal/payment-links/${encodeURIComponent(paymentLinkId)}`,
      {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 12000,
        validateStatus: () => true,
      }
    );
    const payload =
      body && typeof body === 'object' && body.success === true && body.data !== undefined ? body.data : body;
    if (status !== 200) {
      const msg =
        payload && typeof payload === 'object'
          ? payload.error || payload.message
          : typeof payload === 'string'
            ? payload
            : null;
      throw new AppError(msg || 'Payment link unavailable', status >= 400 && status < 600 ? status : 502);
    }
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn(`[orders] fetchPaymentLinkCheckoutContext: ${err.message}`);
    throw new AppError('Payment link service unavailable', 502);
  }
}

/**
 * Freeze what the link is selling onto the order.
 *
 * Read once at order-create time and never again: an admin can edit the link — or
 * repoint it at a different course — between the buyer opening Razorpay and paying,
 * and the buyer must get what the page they paid on promised.
 *
 * Returns null for money-only links, which keeps `fulfilment` NULL on the order and
 * leaves fulfilment behaving exactly as it did before links could sell products.
 */
async function buildPaymentLinkFulfilment(link) {
  const productType = link && link.product_type ? String(link.product_type).toLowerCase() : 'custom';
  const productId = link && link.product_id != null && String(link.product_id).trim() !== ''
    ? String(link.product_id).trim()
    : null;
  if (productType === 'custom' || !productId) return null;

  const snapshot = {
    product_type: productType,
    product_id: productId,
    batch_id: null,
    auto_enroll: link.auto_enroll !== false && link.auto_enroll !== 0,
  };

  if (productType === 'course') {
    const explicit = Number(link.batch_id);
    snapshot.batch_id = Number.isFinite(explicit) && explicit > 0
      ? explicit
      : await fetchPurchaseBatchId(productId);
  } else if (productType === 'membership') {
    // grant-membership keys off the plan slug. Resolving it here means a plan lookup
    // failing later can't degrade the grant into a bogus tier — see emitMembershipGrant.
    const plan = await fetchPlanDetails(productId);
    if (plan?.slug) snapshot.plan_slug = plan.slug;
  }

  return snapshot;
}

async function createPaymentLinkOrder(userId, body) {
  const paymentLinkId = String(body.paymentLinkId ?? '').trim();
  const fullName = String(body.fullName || '').trim();
  const email = String(body.email || '').trim();
  const mobile = String(body.mobile || '').trim();
  const gstRaw = body.gstNumber != null ? String(body.gstNumber).trim() : '';
  const gstNumber = gstRaw === '' ? null : gstRaw;

  if (!paymentLinkId) throw new AppError('paymentLinkId is required', 400);
  if (!fullName) throw new AppError('Full name is required', 400);
  if (!email) throw new AppError('Email is required', 400);
  if (!mobile) throw new AppError('Mobile number is required', 400);

  const link = await fetchPaymentLinkCheckoutContext(paymentLinkId);

  const salePrice = parseAmount(link.sale_price);
  const listAmount = parseAmount(link.amount);
  if (!Number.isFinite(salePrice) || salePrice < 0) throw new AppError('Invalid payment link price', 400);

  const fulfilment = await buildPaymentLinkFulfilment(link);
  // Course links carry the batch on the order itself as well, so batch reconciliation
  // and enrollment reporting see a payment-link purchase the same way they see a
  // direct course order.
  const orderBatchId = fulfilment && fulfilment.product_type === 'course' ? fulfilment.batch_id : null;

  const discountAmount = 0;
  const afterDiscount = salePrice;
  const gstAmount = Number((afterDiscount * GST_RATE).toFixed(2));
  const grandTotal = Number((afterDiscount + gstAmount).toFixed(2));

  const lockKey = `order:lock:pl:${paymentLinkId}:${email.toLowerCase()}`;
  const redis = await getRedis();
  const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 45 });
  if (!gotLock) throw new AppError('Duplicate order in progress', 429);

  const emailLower = email.trim().toLowerCase();

  try {
    if (grandTotal <= 0) {
      // A ₹0 link grants access just like a paid one and never passes through
      // completePayment, so it resolves its buyer here instead.
      const freeBuyerUserId =
        userId != null
          ? Number(userId)
          : await resolveBuyerUserId(
              {
                order_id: `payment-link:${paymentLinkId}`,
                user_id: null,
                buyer_email: emailLower,
                buyer_name: fullName,
                buyer_mobile: mobile,
                fulfilment,
              },
              { allowCreate: orderNeedsBuyerAccount({ fulfilment }) }
            );

      let outOrderId;
      await sequelize.transaction(async (t) => {
        let row = await Order.findOne({
          where: {
            [Op.and]: [
              { type: 'payment_link', entity_id: String(paymentLinkId), status: { [Op.in]: ['pending', 'failed'] } },
              sequelize.where(sequelize.fn('LOWER', sequelize.col('buyer_email')), emailLower),
            ],
          },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (row) {
          await row.update(
            {
              status: 'pending',
              user_id: freeBuyerUserId != null ? freeBuyerUserId : row.user_id,
              original_amount: listAmount,
              amount: grandTotal,
              affiliate: normalizeReferralForOrder(body.referralCode),
              gateway: 'free',
              buyer_name: fullName,
              buyer_email: emailLower,
              buyer_mobile: mobile,
              buyer_gst: gstNumber,
              utm: body.utm != null ? body.utm : row.utm,
              // Refreshed on reuse — a pending order retried after the admin edited the
              // link must deliver what the buyer is looking at now, not last week's product.
              batch_id: orderBatchId,
              fulfilment,
            },
            { transaction: t }
          );
          row = await Order.findByPk(row.id, { transaction: t, lock: t.LOCK.UPDATE });
          outOrderId = row.order_id;
        } else {
          const oid = generateOrderId();
          outOrderId = oid;
          row = await Order.create(
            {
              order_id: oid,
              user_id: freeBuyerUserId || null,
              type: 'payment_link',
              entity_id: String(paymentLinkId),
              batch_id: orderBatchId,
              fulfilment,
              original_amount: listAmount,
              coupon_code: null,
              coupon_discount: 0,
              amount: grandTotal,
              currency: 'INR',
              status: 'pending',
              affiliate: normalizeReferralForOrder(body.referralCode),
              gateway: 'free',
              buyer_name: fullName,
              buyer_email: emailLower,
              buyer_mobile: mobile,
              buyer_gst: gstNumber,
            },
            { transaction: t }
          );
        }
        const locked = await Order.findOne({
          where: { id: row.id },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (!locked) throw new AppError('Order not found after create', 500);
        await locked.update({ status: 'paid' }, { transaction: t });
        const freeRef = `free:${locked.order_id}`;
        await Payment.findOrCreate({
          where: { order_id: locked.id, source: 'free' },
          defaults: {
            order_id: locked.id,
            razorpay_payment_id: freeRef,
            razorpay_signature: null,
            amount: locked.amount,
            status: 'captured',
            source: 'free',
          },
          transaction: t,
        });
        await emitPurchaseOutbox(locked, t);
        await emitPaymentEmailOutbox(locked, `free:${locked.order_id}`, 'success', t);
        await emitCoursePurchaseWebhookOutbox(locked, `free:${locked.order_id}`, t);
      });
      await redis.del(lockKey);
      // Free links fulfil here without completePayment — verify the buyer now so the
      // success page (gated on verified email) doesn't bounce them.
      await markBuyerEmailVerified(freeBuyerUserId, outOrderId);
      const rpConfig = await getRazorpayConfig();
      return {
        orderId: outOrderId,
        free: true,
        paid: true,
        razorpayOrderId: null,
        amount: 0,
        originalAmount: Math.round(listAmount * 100),
        discountAmount: 0,
        gstAmount: Math.round(gstAmount * 100),
        grandTotal: 0,
        currency: 'INR',
        key: rpConfig?.key_id || null,
        prefill: { name: fullName, email, contact: mobile },
      };
    }

    const razorpay = await getRazorpayInstance();
    if (!razorpay) throw new AppError('Payment not configured', 503);

    const amountPaise = Math.round(grandTotal * 100);
    let order;

    await sequelize.transaction(async (t) => {
      order = await Order.findOne({
        where: {
          [Op.and]: [
            { type: 'payment_link', entity_id: String(paymentLinkId), status: { [Op.in]: ['pending', 'failed'] } },
            sequelize.where(sequelize.fn('LOWER', sequelize.col('buyer_email')), emailLower),
          ],
        },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });
      if (order) {
        await order.update(
          {
            status: 'pending',
            user_id: userId != null ? userId : order.user_id,
            original_amount: listAmount,
            coupon_code: null,
            coupon_discount: discountAmount,
            amount: grandTotal,
            currency: 'INR',
            affiliate: normalizeReferralForOrder(body.referralCode),
            buyer_name: fullName,
            buyer_email: emailLower,
            buyer_mobile: mobile,
            buyer_gst: gstNumber,
            utm: body.utm != null ? body.utm : order.utm,
            // Refreshed on reuse — a pending order retried after the admin edited the
            // link must deliver what the buyer is looking at now, not last week's product.
            batch_id: orderBatchId,
            fulfilment,
          },
          { transaction: t }
        );
        order = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      } else {
        const oid = generateOrderId();
        order = await Order.create(
          {
            order_id: oid,
            user_id: userId || null,
            type: 'payment_link',
            entity_id: String(paymentLinkId),
            batch_id: orderBatchId,
            fulfilment,
            original_amount: listAmount,
            coupon_code: null,
            coupon_discount: discountAmount,
            amount: grandTotal,
            currency: 'INR',
            status: 'pending',
            affiliate: normalizeReferralForOrder(body.referralCode),
            buyer_name: fullName,
            buyer_email: emailLower,
            buyer_mobile: mobile,
            buyer_gst: gstNumber,
            utm: body.utm || null,
          },
          { transaction: t }
        );
      }
    });

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: order.order_id,
      notes: {
        orderId: order.order_id,
        userId: userId != null ? String(userId) : '',
        type: 'PAYMENT_LINK',
        entityId: String(paymentLinkId),
      },
    });

    await order.update({ razorpay_order_id: rpOrder.id });

    await redis.del(lockKey);

    const rpConfig = await getRazorpayConfig();

    return {
      orderId: order.order_id,
      free: false,
      paid: false,
      razorpayOrderId: rpOrder.id,
      amount: amountPaise,
      originalAmount: Math.round(listAmount * 100),
      discountAmount: Math.round(discountAmount * 100),
      gstAmount: Math.round(gstAmount * 100),
      grandTotal: Math.round(grandTotal * 100),
      currency: 'INR',
      key: rpConfig?.key_id,
      prefill: {
        name: fullName,
        email,
        contact: mobile,
      },
    };
  } catch (err) {
    await redis.del(lockKey).catch(() => { });
    throw err;
  }
}

async function verifyPaymentLinkOrder({ orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const rpConfig = await getRazorpayConfig();
  if (!rpConfig) throw new AppError('Payment not configured', 503);

  const expected = crypto
    .createHmac('sha256', rpConfig.key_secret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (expected !== razorpay_signature) throw new AppError('Invalid signature', 400);

  const order = await Order.findOne({ where: { order_id: orderId, type: 'payment_link' } });
  if (!order) throw new AppError('Order not found', 404);

  if (order.razorpay_order_id && order.razorpay_order_id !== razorpay_order_id) {
    logger.warn('[verifyPaymentLinkOrder] razorpay_order_id mismatch');
    throw new AppError('Order ID mismatch', 400);
  }

  if (order.status === 'paid') {
    return { alreadyPaid: true, message: 'Already paid' };
  }

  return completePayment(order, razorpay_payment_id, { signature: razorpay_signature, source: 'checkout' });
}

// ─── verifyOrder ─────────────────────────────────────────────────────────────
// SECURITY:
//  1. Verifies Razorpay signature using HMAC(key_secret, rp_order_id|rp_payment_id)
//  2. Ensures the Razorpay order ID on the order row matches what was signed
//     → prevents a user from submitting payment proof for order A to complete order B

async function verifyOrder(userId, { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const rpConfig = await getRazorpayConfig();
  if (!rpConfig) throw new AppError('Payment not configured', 503);

  // 1. Validate signature first — cheap, no DB needed
  const expected = crypto
    .createHmac('sha256', rpConfig.key_secret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (expected !== razorpay_signature) throw new AppError('Invalid signature', 400);

  // 2. Load our order
  const order = await Order.findOne({ where: { order_id: orderId, user_id: userId } });
  if (!order) throw new AppError('Order not found', 404);

  // 3. Cross-check: the Razorpay order ID signed must match what we stored
  //    This prevents "submit payment of order A to fulfil order B" attacks
  if (order.razorpay_order_id && order.razorpay_order_id !== razorpay_order_id) {
    logger.warn(`[verifyOrder] razorpay_order_id mismatch — stored: ${order.razorpay_order_id}, received: ${razorpay_order_id}`);
    throw new AppError('Order ID mismatch', 400);
  }

  // 4. Guard: don't re-process a completed order
  if (order.status === 'paid') {
    return { alreadyPaid: true, message: 'Already paid' };
  }

  return completePayment(order, razorpay_payment_id, { signature: razorpay_signature, source: 'checkout' });
}

// ─── Read-only query helpers ──────────────────────────────────────────────────

/**
 * For a course + a set of user ids, resolve how each user's access to that course
 * was granted: a direct course purchase, a membership plan that included the course,
 * or unknown (predates the outbox / admin-granted / migrated data with no trace).
 * Used by admin-service to annotate batch-enrollment listings so "enrolled with no
 * matching course order" can be told apart from "enrolled via membership" instead of
 * both looking like the same mismatch.
 */
async function getEnrollmentSources(courseId, userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return [];

  const rows = await sequelize.query(
    `SELECT payload FROM outbox_events
     WHERE event_type = 'COURSE_PURCHASED'
       AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.courseId')) = :courseId
       AND CAST(JSON_UNQUOTE(JSON_EXTRACT(payload, '$.userId')) AS UNSIGNED) IN (:ids)
     ORDER BY id DESC`,
    { replacements: { courseId: String(courseId), ids }, type: QueryTypes.SELECT }
  );

  const byUser = new Map();
  for (const row of rows) {
    let p = row.payload;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { continue; } }
    if (!p || p.userId == null || p.courseId == null) continue;
    const uid = Number(p.userId);
    if (!ids.includes(uid) || byUser.has(uid)) continue; // keep latest only (rows are DESC by id)
    byUser.set(uid, {
      user_id: uid,
      source: p.isMembershipLinked ? 'membership' : 'course_order',
      order_id: p.orderId || null,
      is_membership_linked: !!p.isMembershipLinked,
    });
  }

  // The outbox payload only proves an order EXISTED at the time the event was
  // created -- it says nothing about whether that order still exists now. An order
  // can be hard-deleted after the fact (see deleteOrderPermanently's force-delete
  // guard) leaving the outbox trail behind. Trusting the payload blindly here is
  // exactly why "paid orders" and "direct order enrollments" counts can drift apart:
  // a deleted-order enrollment would silently count as a resolved 'course_order'.
  // Verify every referenced order still exists (and is still paid) before trusting it.
  const candidateOrderIds = [...byUser.values()].map((v) => v.order_id).filter(Boolean);
  if (candidateOrderIds.length) {
    const foundOrders = await Order.findAll({
      where: { order_id: { [Op.in]: candidateOrderIds } },
      attributes: ['order_id', 'status'],
      paranoid: false, // include soft-deleted (trashed) too -- still not a live paid order
    });
    const statusByOrderId = new Map(foundOrders.map((o) => [o.order_id, o.status]));
    for (const [uid, entry] of byUser) {
      if (!entry.order_id) continue;
      const status = statusByOrderId.get(entry.order_id);
      if (status === undefined) {
        // Order no longer exists at all -- the enrollment is orphaned from a deleted order.
        entry.source = 'deleted_order';
        entry.order_status = null;
      } else if (status !== 'paid') {
        entry.source = 'unpaid_order';
        entry.order_status = status;
      } else {
        entry.order_status = 'paid';
      }
    }
  }

  // Outbox events only exist for orders processed by the current order-service (it's
  // where they're created). Anything still unresolved -- OR resolved only to a
  // deleted/unpaid order via a stale outbox trace -- may still have a DIFFERENT,
  // currently live paid order behind it (e.g. the original order was hard-deleted
  // and the purchase was later recreated under a new order_id with no outbox event
  // of its own). Fall back to the orders table itself, using the same entity_id +
  // type='course' relation as everywhere else (never bare course_id -- see fix in
  // migrate-wp-to-ms.js for why). Pull EVERY status (paid/pending/failed/refunded)
  // so pending/failed orders stay visible for context -- but only a 'paid' order
  // actually explains the enrollment, and a paid result here always wins over a
  // stale deleted/unpaid outbox-based guess.
  const stillUnresolved = ids.filter((uid) => {
    const cur = byUser.get(uid);
    return !cur || cur.source === 'deleted_order' || cur.source === 'unpaid_order';
  });
  if (stillUnresolved.length) {
    const orders = await Order.findAll({
      where: {
        type: 'course',
        entity_id: String(courseId),
        user_id: { [Op.in]: stillUnresolved },
      },
      attributes: ['user_id', 'order_id', 'status', 'created_at'],
      order: [['created_at', 'DESC']],
    });

    // Latest order per user (rows are DESC by created_at), preferring a paid one
    // over a later pending/failed attempt for the same course.
    const latestOrderByUser = new Map();
    for (const o of orders) {
      const uid = Number(o.user_id);
      const existing = latestOrderByUser.get(uid);
      if (!existing || (existing.status !== 'paid' && o.status === 'paid')) {
        latestOrderByUser.set(uid, o);
      }
    }

    // Cross-check by aggregate_id (the order's own id) against ALL outbox events for
    // that order, regardless of event_type -- this catches cases the payload-content
    // match above missed (e.g. an ORDER_REFUNDED event explaining why access no
    // longer matches, or confirming COURSE_PURCHASED did fire for this exact order).
    const orderIds = [...latestOrderByUser.values()].map((o) => o.order_id).filter(Boolean);
    const traceByOrderId = new Map();
    if (orderIds.length) {
      const traces = await OutboxEvent.findAll({
        where: { aggregate_type: 'order', aggregate_id: { [Op.in]: orderIds } },
        attributes: ['aggregate_id', 'event_type', 'status'],
        order: [['id', 'DESC']],
      });
      for (const t of traces) {
        if (!traceByOrderId.has(t.aggregate_id)) traceByOrderId.set(t.aggregate_id, []);
        traceByOrderId.get(t.aggregate_id).push({ event_type: t.event_type, status: t.status });
      }
    }

    for (const [uid, o] of latestOrderByUser) {
      const existing = byUser.get(uid);
      // Don't let a fallback 'unpaid_order' clobber an existing 'deleted_order' guess
      // (both are non-paid, neither is more informative) -- but a paid result here
      // always overrides, since it's the strongest evidence available.
      if (existing && existing.source !== 'deleted_order' && existing.source !== 'unpaid_order') continue;
      if (existing && o.status !== 'paid') continue;

      const trace = traceByOrderId.get(o.order_id) || [];
      const wasRefunded = trace.some((t) => t.event_type === 'ORDER_REFUNDED');
      byUser.set(uid, {
        user_id: uid,
        // Only a paid order actually explains the enrollment -- pending/failed orders
        // are surfaced for context but don't count as a resolved source.
        source: o.status === 'paid' ? 'course_order' : 'unpaid_order',
        order_id: o.order_id,
        is_membership_linked: false,
        order_status: o.status,
        order_was_refunded: wasRefunded,
        outbox_trace: trace,
      });
    }
  }

  return ids.map((uid) => byUser.get(uid) || {
    user_id: uid,
    source: 'unknown',
    order_id: null,
    is_membership_linked: false,
  });
}

async function listOrders(userId) {
  const rows = await Order.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    attributes: ['order_id', 'type', 'entity_id', 'amount', 'currency', 'status', 'created_at'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function fetchProgressSummary(userId, courseIds) {
  const ids = [...new Set((courseIds || []).map(Number).filter((n) => n > 0))];
  if (!ids.length) return {};
  try {
    const { data } = await axios.post(
      `${config.courseServiceUrl}/internal/progress/summary`,
      { userId, courseIds: ids },
      {
        timeout: 12000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      }
    );
    const payload = parseApiResponse(data);
    return payload && typeof payload === 'object' ? payload : {};
  } catch (err) {
    logger.warn(`[orders] progress summary failed: ${err.message}`);
    return {};
  }
}

/** Bulk-load course metadata for purchase history (includes draft/unpublished migrated courses). */
async function fetchCoursesMetaMap(entityIds) {
  const ids = [...new Set(entityIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await sequelize.query(
    `SELECT id, title, slug, brief_description, description, thumbnail_url, price, enrolled_count, status, created_at, updated_at
     FROM courses
     WHERE id IN (:ids) AND ${sqlDeletedAtIsNull()}`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  for (const row of rows) {
    map.set(String(row.id), row);
  }
  return map;
}

/** Bulk-load batch rows for my-purchases (shared DB). */
async function fetchBatchesMap(batchIds) {
  const ids = [...new Set(batchIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await sequelize.query(
    `SELECT b.id, b.name, b.start_date, b.end_date, b.meet_link, b.course_id, c.slug AS course_slug
     FROM batches b
     LEFT JOIN courses c ON c.id = b.course_id
     WHERE b.id IN (:ids)`,
    { replacements: { ids }, type: QueryTypes.SELECT },
  );
  for (const row of rows) {
    map.set(Number(row.id), row);
  }
  return map;
}

/**
 * The course/plan an order actually conferred.
 *
 * For course and membership orders that is just type/entity_id. A payment-link order
 * carries the *link* id in entity_id, so its real target lives in the fulfilment
 * snapshot — without this, a learner who bought a course through a payment link sees a
 * blank "Purchase" tile in My Purchases instead of the course they own.
 */
function effectivePurchaseTarget(order) {
  const type = String(order.type || '');
  if (type !== 'payment_link') return { type, entityId: order.entity_id };

  const snapshot = parseFulfilment(order);
  const granted = snapshot?.product_type ? String(snapshot.product_type) : 'custom';
  if (granted === 'custom' || !snapshot.product_id) return { type, entityId: order.entity_id };
  return { type: granted, entityId: String(snapshot.product_id) };
}

async function listMyPurchases(userId) {
  // Return:
  //  - fully paid orders (native + migrated active purchases), AND
  //  - migrated legacy orders carrying a WP workflow status ('publish' = active,
  //    'draft' = expired). The legacy site lists one card per order (duplicates
  //    allowed) and shows expired orders regardless of payment, so we mirror that.
  const rows = await Order.findAll({
    where: {
      user_id: userId,
      [Op.or]: [
        { status: 'paid' },
        { wp_post_status: { [Op.in]: ['publish', 'draft'] } },
      ],
    },
    order: [['created_at', 'DESC']],
  });
  const plainRows = rows.map((row) => row.get({ plain: true }));
  const targetByOrderId = new Map(plainRows.map((o) => [o.id, effectivePurchaseTarget(o)]));

  const courseEntityIds = plainRows
    .map((o) => targetByOrderId.get(o.id))
    .filter((target) => target.type === 'course' && target.entityId)
    .map((target) => Number(target.entityId));
  const courseMetaMap = await fetchCoursesMetaMap(courseEntityIds);

  const orderIds = plainRows.map((o) => o.id);
  const batchIds = [...new Set(plainRows.map((o) => o.batch_id).filter(Boolean))];

  const [paymentRows, batchMap] = await Promise.all([
    orderIds.length
      ? Payment.findAll({
          where: { order_id: { [Op.in]: orderIds } },
          order: [['id', 'DESC']],
        })
      : [],
    fetchBatchesMap(batchIds),
  ]);
  const paymentByOrderId = new Map();
  for (const p of paymentRows) {
    const oid = p.order_id;
    if (!paymentByOrderId.has(oid)) paymentByOrderId.set(oid, p);
  }

  const out = [];
  for (const o of plainRows) {
    const payment = paymentByOrderId.get(o.id) || null;
    const target = targetByOrderId.get(o.id) || { type: String(o.type || ''), entityId: o.entity_id };
    let course = null;
    if (target.type === 'course' && target.entityId) {
      const meta = courseMetaMap.get(String(target.entityId)) || null;
      const cid = String(target.entityId);
      course = {
        id: cid,
        title: meta?.title || `Course ${cid}`,
        slug: meta?.slug ?? null,
        description: meta?.brief_description || meta?.description || '',
        thumbnail: meta?.thumbnail_url || '',
        thumbnail_url: meta?.thumbnail_url || null,
        price: meta?.price != null ? Number(meta.price) : Number(o.amount) || 0,
        category: meta?.category || '',
        level: meta?.level || 'beginner',
        duration: meta?.duration || 0,
        instructorId: meta?.instructorId || '',
        instructor: meta?.instructor || { id: '', name: '' },
        totalStudents: meta?.enrolled_count || 0,
        featured: !!meta?.featured,
        status: meta?.status || 'published',
        createdAt: meta?.created_at || o.created_at,
        updatedAt: meta?.updated_at || o.created_at,
      };
    } else {
      const label = target.type === 'membership' ? 'Membership' : 'Purchase';
      course = {
        id: target.entityId ? String(target.entityId) : String(o.id),
        title: label,
        description: '',
        thumbnail: '',
        thumbnail_url: null,
        price: Number(o.amount) || 0,
        category: target.type || '',
        level: 'beginner',
        duration: 0,
        instructorId: '',
        instructor: { id: '', name: '' },
        totalStudents: 0,
        featured: false,
        status: 'published',
        createdAt: o.created_at,
        updatedAt: o.created_at,
      };
    }

    const purchaseStatus =
      o.status === 'paid' ? 'completed' : o.status === 'pending' ? 'pending' : 'failed';

    let enrolledBatch = null;
    if (target.type === 'course' && o.batch_id && course) {
      const batchRow = batchMap.get(Number(o.batch_id)) || null;
      if (batchRow) {
        const phase = computeLiveBatchPhase(batchRow);
        enrolledBatch = {
          batchId: batchRow.id,
          name: batchRow.name,
          startDate: batchRow.start_date,
          endDate: batchRow.end_date,
          meetLink: batchRow.meet_link || null,
          phase,
        };
        if (batchRow.course_slug && !course.slug) {
          course.slug = batchRow.course_slug;
        }
      }
    }

    out.push({
      id: String(o.id),
      userId: String(o.user_id),
      courseId: target.entityId ? String(target.entityId) : String(o.id),
      course,
      // Batch this purchase was locked to (nullable — e.g. courses without batches yet).
      batchId: o.batch_id || null,
      enrolledBatch,
      purchaseDate: o.created_at,
      price: Number(o.amount) || 0,
      paymentMethod: formatPaymentMethodLabel(o.gateway, {
        amount: o.amount,
        hasRazorpayPayment: !!payment,
      }),
      transactionId: o.order_id || String(o.id),
      status: purchaseStatus,
      // Legacy WP workflow status: 'publish' = active, 'draft' = expired, null = native order.
      wpPostStatus: o.wp_post_status || null,
      progress: 0,
      completedLessons: [],
      completedAt: undefined,
      lastAccessedAt: undefined,
    });
  }

  // NOTE: Intentionally NOT de-duplicating by courseId. The legacy site shows one
  // card per order (the same course can appear multiple times across active/expired),
  // so we preserve every order row to match it exactly.

  // Fetch expires_at for each course purchase from user_courses (shared DB).
  // user_courses is the LIVE source of truth for current access: it is (re)granted
  // on every purchase, so a repurchase renews it. wp_post_status, by contrast, is a
  // frozen snapshot from migration time that is never updated — so we let a live
  // active grant override a stale legacy 'draft' (expired) card (see below).
  const expiryMap = new Map();
  /**
   * Courses an admin has deallotted, surfaced per row as `revoked`.
   *
   * Reported, never filtered out here. This list is also the learner's payment history
   * and the source of their invoices, and deallotting a course does not unmake the
   * payment — that is exactly why the order and payment rows are kept. Callers that show
   * course *access* (My Courses, the "continue learning" CTA) skip revoked rows
   * themselves; callers that show *money* keep every one.
   *
   * Only a stamped `revoked_at` counts — a course with no row at all is NOT revoked, it
   * is a grant that has not been written yet (the outbox worker grants asynchronously, so
   * every just-paid order passes through that state).
   */
  const revokedCourseIds = new Set();
  if (courseEntityIds.length > 0) {
    const placeholders = courseEntityIds.map(() => '?').join(',');
    const expiryRows = await sequelize.query(
      `SELECT course_id, expires_at, revoked_at FROM user_courses WHERE user_id = ? AND course_id IN (${placeholders})`,
      { replacements: [userId, ...courseEntityIds], type: QueryTypes.SELECT }
    );
    for (const row of expiryRows) {
      if (row.revoked_at) {
        revokedCourseIds.add(Number(row.course_id));
        continue;
      }
      expiryMap.set(Number(row.course_id), row.expires_at ?? null);
    }
  }

  const now = new Date();
  for (const item of out) {
    if (!item.course || !courseEntityIds.includes(Number(item.courseId))) continue;

    // An admin deallotted this course. The order stands (payment history, invoice), but
    // the learner has no access, so access-facing views drop the row on this flag.
    item.revoked = revokedCourseIds.has(Number(item.courseId));

    // Live access from user_courses: a row with expires_at = null (lifetime) or a
    // future date means the learner currently has access to this course.
    const hasGrant = expiryMap.has(Number(item.courseId));
    const grantExpiresAt = hasGrant ? expiryMap.get(Number(item.courseId)) : null;
    const grantActive = hasGrant && (!grantExpiresAt || new Date(grantExpiresAt) > now);

    if (item.revoked) {
      // Deallotted: no access, whatever the grant window or the legacy flag says. Checked
      // before wpPostStatus, which is a snapshot frozen at migration time and would
      // otherwise report a removed course as active.
      item.accessStatus = 'expired';
      item.accessExpiresAt = null;
    } else if (item.wpPostStatus === 'publish') {
      // Legacy active order — authoritative.
      item.accessStatus = 'active';
      item.accessExpiresAt = null;
    } else if (item.wpPostStatus === 'draft') {
      // Legacy expired order. This flag is frozen at migration time and can't see a
      // later repurchase, so defer to the live user_courses grant: if the learner
      // now has active access (e.g. they rebought the course), show active with the
      // real window; only honour the legacy 'expired' when there is no active grant.
      if (grantActive) {
        item.accessStatus = 'active';
        item.accessExpiresAt = grantExpiresAt ? new Date(grantExpiresAt).toISOString() : null;
      } else {
        item.accessStatus = 'expired';
        item.accessExpiresAt = null;
      }
    } else {
      // Native order: fall back to the user_courses access window.
      item.accessExpiresAt = grantExpiresAt ? new Date(grantExpiresAt).toISOString() : null;
      item.accessStatus = !grantExpiresAt || new Date(grantExpiresAt) > now ? 'active' : 'expired';
    }
  }

  const summary = await fetchProgressSummary(userId, courseEntityIds);
  for (const item of out) {
    const cid = Number(item.courseId);
    const s = summary[cid] || summary[String(cid)];
    if (!s) continue;
    item.progress = Number(s.progress) || 0;
    const done = Number(s.completedLessons) || 0;
    item.completedLessons = Array.from({ length: done }, (_, i) => String(i));
    if (item.course) item.course.totalLessons = Number(s.totalLessons) || 0;
    if (s.status === 'completed') item.completedAt = new Date().toISOString();
  }

  return out;
}

function parseAmountFilter(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Admin YYYY-MM-DD filters are inclusive calendar days in Asia/Kolkata (IST). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function parseYmdDateParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
}

function istDayStartInstant(dateStr) {
  const p = parseYmdDateParts(dateStr);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.mo, p.d, 0, 0, 0, 0) - IST_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

function istDayEndInstant(dateStr) {
  const p = parseYmdDateParts(dateStr);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.mo, p.d, 23, 59, 59, 999) - IST_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveFilterRangeStart(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const ist = istDayStartInstant(s);
  if (ist) return ist;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveFilterRangeEnd(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const ist = istDayEndInstant(s);
  if (ist) return ist;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function applyCreatedAtRangeToWhere(where, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return;
  where.created_at = {};
  const start = resolveFilterRangeStart(dateFrom);
  if (start) where.created_at[Op.gte] = start;
  const end = resolveFilterRangeEnd(dateTo);
  if (end) where.created_at[Op.lte] = end;
}

/**
 * The payment reference an admin should see for an order.
 *
 * `manual:`/`free:` refs are internally generated capture placeholders, not something
 * an admin typed. When the payment row carries one of those, prefer the order's own
 * reference — that's where a shared bulk-allotment settlement id is recorded. Orders
 * with a real captured ref are unaffected.
 */
function resolveAdminPaymentId(order, payment) {
  const capturedRef = payment ? payment.razorpay_payment_id : null;
  const capturedRefIsSynthetic =
    !!capturedRef && (capturedRef.startsWith('manual:') || capturedRef.startsWith('free:'));
  if (capturedRef && !capturedRefIsSynthetic) return capturedRef;
  return (order && order.rp_payment_id) || capturedRef || null;
}

async function listAllOrders({
  limit = 100,
  offset = 0,
  search = '',
  sortBy = 'created_at',
  sortOrder = 'DESC',
  dateFrom,
  dateTo,
  courseId,
  type,
  amountMin,
  amountMax,
  status,
  trashed,
  courseAccess,
}) {
  const trashMode = parseTrashedMode({ trashed });
  let where = {};

  if (search && String(search).trim()) {
    const term = String(search).trim();

    // Match payment ID → order ids.
    const paymentRows = await Payment.findAll({
      where: { razorpay_payment_id: { [Op.like]: `%${term}%` } },
      attributes: ['order_id'],
      raw: true,
    });
    const orderIdsFromPayments = [...new Set(paymentRows.map((p) => p.order_id))];

    // Match buyer name/email/phone on the linked user record → user ids.
    // Many orders store buyer info only on the user, so searching the order's
    // own buyer_* columns alone misses them — resolve matching users too.
    let userIdsFromSearch = [];
    try {
      const { data: body } = await axios.post(
        `${config.authServiceUrl}/users/internal/search-ids`,
        { term },
        { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 5000 }
      );
      const ids = body && typeof body === 'object' && 'data' in body ? body.data : body;
      if (Array.isArray(ids)) userIdsFromSearch = ids;
    } catch (err) {
      logger.warn(`[orders] user search-ids failed: ${err.message}`);
    }

    const orClauses = [
      { order_id: { [Op.like]: `%${term}%` } },
      { buyer_email: { [Op.like]: `%${term}%` } },
      { buyer_name: { [Op.like]: `%${term}%` } },
      { buyer_mobile: { [Op.like]: `%${term}%` } },
      // Bulk allotment records its settlement reference on the order, not on the
      // payments row (see sharedPaymentRef in createManualOrder), so the payment-ID
      // lookup above never sees it. Without this clause an admin searching the
      // payment ID they typed into the allotment form gets no results.
      { rp_payment_id: { [Op.like]: `%${term}%` } },
    ];
    if (orderIdsFromPayments.length) {
      orClauses.push({ id: { [Op.in]: orderIdsFromPayments } });
    }
    if (userIdsFromSearch.length) {
      // Restrict the user-profile fallback to orders that have no stored buyer_email.
      // If an order already has its own buyer_email, the LIKE clause above handles it.
      // Without this guard, every order ever placed by a matching user is returned —
      // including orders with a completely different stored email — causing false positives.
      orClauses.push({
        [Op.and]: [
          { user_id: { [Op.in]: userIdsFromSearch } },
          {
            [Op.or]: [
              { buyer_email: { [Op.is]: null } },
              { buyer_email: '' },
            ],
          },
        ],
      });
    }
    where[Op.or] = orClauses;
  }

  if (status) {
    const s = String(status).toLowerCase().trim();
    if (s === 'completed') {
      where.status = { [Op.in]: ['paid', 'completed'] };
    } else {
      where.status = s;
    }
  }

  applyCreatedAtRangeToWhere(where, dateFrom, dateTo);

  if (courseId) {
    where.entity_id = String(courseId);
    where.type = 'course';
  }

  if (type) {
    where.type = type.toLowerCase();
  }

  const minAmount = parseAmountFilter(amountMin);
  const maxAmount = parseAmountFilter(amountMax);
  if (minAmount != null || maxAmount != null) {
    where.amount = {};
    if (minAmount != null) where.amount[Op.gte] = minAmount;
    if (maxAmount != null) where.amount[Op.lte] = maxAmount;
  }

  const listWhere = mergeCourseAccessFilter(withTrashedWhere(where, trashMode), courseAccess);

  const whereClause = listWhere;
  const order = [[sortBy, sortOrder]];
  const findLimit = Math.min(Number(limit) || 100, 500);
  const findOffset = Number(offset) || 0;

  const { rows, count } = await Order.findAndCountAll({
    where: whereClause,
    ...trashedSequelizeOptions(trashMode),
    order,
    attributes: [
      'id',
      'order_id',
      'user_id',
      'type',
      'entity_id',
      'amount',
      'currency',
      'status',
      'buyer_email',
      'buyer_name',
      'buyer_mobile',
      'created_at',
      'refund_amount',
      'refund_remarks',
      'utm',
      'gateway',
      // Required by resolveAdminPaymentId below. Bulk-allotment orders keep the real
      // settlement reference here while their payments row holds a synthetic
      // `manual:<orderId>` ref; without this column selected the resolver has nothing
      // to fall back to and the list renders that placeholder as the payment ID.
      'rp_payment_id',
    ],
    limit: findLimit,
    offset: findOffset,
  });

  const orders = rows.map((r) => r.get({ plain: true }));

  // 1. Fetch latest payments for these orders
  const orderIds = orders.map((o) => o.id);
  const payments = await Payment.findAll({
    where: { order_id: { [Op.in]: orderIds } },
    order: [['id', 'DESC']],
    raw: true,
  });
  const paymentMap = {};
  for (const p of payments) {
    if (!paymentMap[p.order_id]) paymentMap[p.order_id] = p;
  }

  // 2. Fetch User info from auth-service for linked users
  const userIds = [...new Set(orders.map((o) => o.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    try {
      const { data: users } = await axios.post(
        `${config.authServiceUrl}/users/internal/list-by-ids`,
        { ids: userIds },
        { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 5000 }
      );
      if (Array.isArray(users.data)) {
        for (const u of users.data) userMap[u.id] = u;
      }
    } catch (err) {
      logger.warn(`Failed to fetch user details for orders: ${err.message}`);
    }
  }

  // 3. Fetch Entity names (Course/Plan)
  // Optimization: fetch in bulk or just use a cache? For now, we do some parallel calls or fallback.
  // Actually, we can fetch all courses and all plans if the lists are small, or just fetch unique ones.
  const courseIds = [...new Set(orders.filter(o => o.type === 'course').map(o => o.entity_id).filter(Boolean))];
  const planIds = [...new Set(orders.filter(o => o.type === 'membership').map(o => o.entity_id).filter(Boolean))];
  const paymentLinkIds = [...new Set(orders.filter(o => o.type === 'payment_link').map(o => o.entity_id).filter(Boolean))];

  const validityByCourseId = await fetchCourseValiditiesMap(courseIds);

  let entityNameMap = {};

  // Bulk fetch courses if any
  if (courseIds.length > 0) {
    try {
      const { data: courseRes } = await axios.post(`${config.courseServiceUrl}/internal/courses/by-ids`, {
        ids: courseIds,
        includeUnpublished: true,
      }, {
        headers: { 'X-Internal-API-Key': config.internalApiKey }
      });
      const courses = courseRes.data || courseRes;
      if (Array.isArray(courses)) {
        for (const c of courses) entityNameMap[`course_${c.id}`] = c.title;
      }
    } catch (err) { logger.warn(`Bulk course fetch failed: ${err.message}`); }
  }

  // Resolve membership plan titles (entity_id may be numeric id or public slug — list-by-ids is numeric-only).
  if (planIds.length > 0) {
    try {
      const settled = await Promise.all(
        planIds.map((pid) =>
          resolveMembershipPlanDisplayName(pid).then((name) => ({ pid: String(pid), name }))
        )
      );
      for (const { pid, name } of settled) {
        if (name) entityNameMap[`membership_${pid}`] = name;
      }
    } catch (err) {
      logger.warn(`Bulk plan resolve failed: ${err.message}`);
    }
  }

  // Resolve payment-link titles via admin-service (no bulk endpoint — fetch each unique id).
  if (paymentLinkIds.length > 0) {
    try {
      const settled = await Promise.all(
        paymentLinkIds.map(async (eid) => {
          try {
            const { data: body, status } = await axios.get(
              `${config.adminServiceUrl}/internal/payment-links/${encodeURIComponent(eid)}`,
              { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 8000, validateStatus: () => true }
            );
            const payload =
              body && typeof body === 'object' && body.success === true && body.data !== undefined ? body.data : body;
            const name =
              status === 200 && payload && typeof payload === 'object' ? payload.title || payload.name || null : null;
            return { eid: String(eid), name };
          } catch {
            return { eid: String(eid), name: null };
          }
        })
      );
      for (const { eid, name } of settled) {
        if (name) entityNameMap[`payment_link_${eid}`] = name;
      }
    } catch (err) {
      logger.warn(`Bulk payment-link resolve failed: ${err.message}`);
    }
  }

  const enrichedData = orders.map((o) => {
    const payment = paymentMap[o.id];
    const user = userMap[o.user_id];

    return {
      ...o,
      payment_id: resolveAdminPaymentId(o, payment),
      // Priority: buyer info on order > linked user info
      buyer_name: o.buyer_name || (user ? user.name : null),
      buyer_email: o.buyer_email || (user ? user.email : null),
      buyer_mobile: o.buyer_mobile || (user ? user.phone : null),
      entity_name:
        entityNameMap[`${o.type}_${o.entity_id}`] ||
        (o.type === 'membership'
          ? 'Plan'
          : o.type === 'payment_link'
            ? 'Payment link'
            : 'Course'),
      course_access: computeCourseAccessLabel(o, validityByCourseId),
    };
  });

  return {
    data: enrichedData,
    meta: {
      total: count,
      page: Math.floor(offset / limit) + 1,
      limit,
      totalPages: Math.ceil(count / limit),
      hasNextPage: offset + limit < count,
      hasPreviousPage: offset > 0,
    },
  };
}

function parseSummaryRow(row) {
  if (!row) {
    return { usage_count: 0, total_original: 0, total_discount: 0, total_paid: 0 };
  }
  return {
    usage_count: Number(row.usage_count) || 0,
    total_original: parseFloat(row.total_original) || 0,
    total_discount: parseFloat(row.total_discount) || 0,
    total_paid: parseFloat(row.total_paid) || 0,
  };
}

async function aggregateCouponUsageWhere(where) {
  const row = await Order.findOne({
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'usage_count'],
      [sequelize.fn('SUM', sequelize.col('original_amount')), 'total_original'],
      [sequelize.fn('SUM', sequelize.col('coupon_discount')), 'total_discount'],
      [sequelize.fn('SUM', sequelize.col('amount')), 'total_paid'],
    ],
    where,
    raw: true,
  });
  return parseSummaryRow(row);
}

/** Per-coupon usage totals for admin coupon list (keyed by coupon id). */
async function getCouponUsageSummary() {
  const aggRows = await sequelize.query(
    `SELECT
      LOWER(TRIM(o.coupon_code)) AS code_key,
      COUNT(*) AS usage_count,
      COALESCE(SUM(o.original_amount), 0) AS total_original,
      COALESCE(SUM(o.coupon_discount), 0) AS total_discount,
      COALESCE(SUM(o.amount), 0) AS total_paid
    FROM orders o
    WHERE o.coupon_code IS NOT NULL AND TRIM(o.coupon_code) <> ''
    GROUP BY code_key`,
    { type: QueryTypes.SELECT }
  );

  const byCode = new Map();
  for (const r of aggRows) {
    byCode.set(String(r.code_key), parseSummaryRow(r));
  }

  const coupons = await Coupon.findAll({
    attributes: ['id', 'code'],
    order: [['created_at', 'DESC']],
    raw: true,
  });

  return coupons.map((c) => {
    const key = String(c.code || '').trim().toLowerCase();
    const stats = byCode.get(key) || parseSummaryRow(null);
    return {
      coupon_id: Number(c.id),
      code: c.code,
      ...stats,
    };
  });
}

/**
 * Admin report: orders that used a coupon (coupon_code on orders + coupon_usages).
 */
async function listCouponUsages({
  limit = 50,
  offset = 0,
  search = '',
  sortBy = 'created_at',
  sortOrder = 'DESC',
  dateFrom,
  dateTo,
  couponCode,
  couponId,
  status,
  type,
}) {
  const pageLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const pageOffset = Math.max(Number(offset) || 0, 0);

  const where = {
    [Op.and]: [
      { coupon_code: { [Op.ne]: null } },
      { coupon_code: { [Op.ne]: '' } },
    ],
  };

  if (couponId) {
    const couponRow = await Coupon.findByPk(couponId, { attributes: ['code'] });
    if (!couponRow) {
      return {
        data: [],
        summary: parseSummaryRow(null),
        meta: {
          total: 0,
          page: 1,
          limit: pageLimit,
          totalPages: 0,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      };
    }
    const codeNorm = String(couponRow.code).trim().toLowerCase();
    where[Op.and].push(
      sequelize.where(sequelize.fn('lower', sequelize.col('coupon_code')), codeNorm)
    );
  } else if (couponCode && String(couponCode).trim()) {
    where.coupon_code = { [Op.like]: `%${String(couponCode).trim()}%` };
  }

  if (status && String(status).trim()) {
    where.status = String(status).trim().toLowerCase();
  }

  if (type && String(type).trim()) {
    where.type = String(type).trim().toLowerCase();
  }

  applyCreatedAtRangeToWhere(where, dateFrom, dateTo);

  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    where[Op.and].push({
      [Op.or]: [
        { order_id: { [Op.like]: term } },
        { buyer_email: { [Op.like]: term } },
        { buyer_name: { [Op.like]: term } },
        { coupon_code: { [Op.like]: term } },
      ],
    });
  }

  const allowedSort = new Set([
    'created_at',
    'order_id',
    'coupon_code',
    'amount',
    'coupon_discount',
    'status',
    'buyer_email',
  ]);
  const orderCol = allowedSort.has(sortBy) ? sortBy : 'created_at';
  const orderDir = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const { rows, count } = await Order.findAndCountAll({
    where,
    order: [[orderCol, orderDir]],
    attributes: [
      'id',
      'order_id',
      'user_id',
      'type',
      'entity_id',
      'amount',
      'original_amount',
      'coupon_code',
      'coupon_discount',
      'currency',
      'status',
      'buyer_name',
      'buyer_email',
      'buyer_mobile',
      'created_at',
    ],
    limit: pageLimit,
    offset: pageOffset,
  });

  const orders = rows.map((r) => r.get({ plain: true }));

  const couponCodes = [...new Set(orders.map((o) => String(o.coupon_code || '').trim().toLowerCase()).filter(Boolean))];
  const couponMap = new Map();
  if (couponCodes.length > 0) {
    const couponRows = await Coupon.findAll({
      where: {
        [Op.or]: couponCodes.map((code) =>
          sequelize.where(sequelize.fn('lower', sequelize.col('code')), code)
        ),
      },
      raw: true,
    });
    for (const c of couponRows) {
      couponMap.set(String(c.code).toLowerCase(), c);
    }
  }

  const userIds = [...new Set(orders.map((o) => o.user_id).filter(Boolean))];
  let userMap = {};
  if (userIds.length > 0) {
    try {
      const { data: usersRes } = await axios.post(
        `${config.authServiceUrl}/users/internal/list-by-ids`,
        { ids: userIds },
        { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 8000 }
      );
      const users = usersRes?.data ?? usersRes;
      if (Array.isArray(users)) {
        for (const u of users) userMap[u.id] = u;
      }
    } catch (err) {
      logger.warn(`[orders] listCouponUsages user fetch failed: ${err.message}`);
    }
  }

  const courseIds = [...new Set(orders.filter((o) => o.type === 'course').map((o) => o.entity_id).filter(Boolean))];
  const planIds = [...new Set(orders.filter((o) => o.type === 'membership').map((o) => o.entity_id).filter(Boolean))];
  const entityNameMap = {};

  if (courseIds.length > 0) {
    try {
      const { data: courseRes } = await axios.post(
        `${config.courseServiceUrl}/internal/courses/by-ids`,
        { ids: courseIds, includeUnpublished: true },
        { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 8000 }
      );
      const list = courseRes?.data ?? courseRes;
      if (Array.isArray(list)) {
        for (const c of list) entityNameMap[`course_${c.id}`] = c.title || c.name;
      }
    } catch (err) {
      logger.warn(`[orders] listCouponUsages course resolve failed: ${err.message}`);
    }
  }

  if (planIds.length > 0) {
    const settled = await Promise.all(
      planIds.map((pid) =>
        resolveMembershipPlanDisplayName(pid).then((name) => ({ pid: String(pid), name }))
      )
    );
    for (const { pid, name } of settled) {
      if (name) entityNameMap[`membership_${pid}`] = name;
    }
  }

  const data = orders.map((o) => {
    const user = userMap[o.user_id];
    const couponMeta = couponMap.get(String(o.coupon_code || '').trim().toLowerCase());
    return {
      id: o.id,
      order_id: o.order_id,
      user_id: o.user_id,
      used_at: o.created_at,
      coupon_code: o.coupon_code,
      coupon_discount: o.coupon_discount,
      original_amount: o.original_amount,
      amount: o.amount,
      currency: o.currency,
      status: o.status,
      type: o.type,
      entity_id: o.entity_id,
      entity_name: entityNameMap[`${o.type}_${o.entity_id}`] || null,
      buyer_name: o.buyer_name || user?.name || null,
      buyer_email: o.buyer_email || user?.email || null,
      buyer_mobile: o.buyer_mobile || user?.phone || null,
      coupon: couponMeta
        ? {
            id: couponMeta.id,
            code: couponMeta.code,
            type: couponMeta.type,
            value: couponMeta.value,
            discount_on: couponMeta.discount_on,
          }
        : null,
    };
  });

  const summary = await aggregateCouponUsageWhere(where);

  return {
    data,
    summary,
    meta: {
      total: count,
      page: Math.floor(pageOffset / pageLimit) + 1,
      limit: pageLimit,
      totalPages: Math.ceil(count / pageLimit) || 0,
      hasNextPage: pageOffset + pageLimit < count,
      hasPreviousPage: pageOffset > 0,
    },
  };
}

/** Revoke course/membership access when an order is refunded or deleted. */
async function revokeAccessForOrder(order) {
  if (!order || !order.user_id) return;
  const userId = order.user_id;
  const oid = order.order_id || order.id;

  // A payment link grants from its fulfilment snapshot, not from type/entity_id
  // (entity_id is the link itself), so a refund has to undo the same thing. Money-only
  // links granted nothing and there is nothing to take back.
  //
  // The ORDER_REFUNDED outbox event still carries the order's own type, so the worker's
  // revoke branch no-ops for payment links — this synchronous path is the one that
  // matters, and it runs inside the refund transaction.
  let type = String(order.type || '');
  let entityId = order.entity_id;
  if (type === 'payment_link') {
    const snapshot = parseFulfilment(order);
    const granted = snapshot?.product_type ? String(snapshot.product_type) : 'custom';
    if (granted === 'custom' || !snapshot.product_id) return;
    type = granted;
    entityId = String(snapshot.product_id);
  }

  if (type === 'course') {
    try {
      await axios.post(`${config.courseServiceUrl}/internal/courses/${entityId}/unenroll`, {
        user_id: userId
      }, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 10000
      });
    } catch (err) {
      logger.warn(`[orders] failed to revoke course ${entityId} access for user ${userId}: ${err.message}`);
    }
  } else if (type === 'membership') {
    // 1. Revoke membership in auth-service
    try {
      await axios.post(`${config.authServiceUrl}/access/revoke-membership`, {
        userId, orderId: oid
      }, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 10000
      });
    } catch (err) {
       logger.warn(`[orders] failed to revoke membership for user ${userId}: ${err.message}`);
    }

    // 2. Resolve linked courses and unenroll
    try {
       const { course_ids = [], course_cat_ids = [] } = await fetchPlanLinkedCourses(entityId);
       const courseSet = new Set(course_ids.map(Number).filter(Boolean));

       if (course_cat_ids.length > 0) {
         try {
           const { data } = await axios.post(`${config.courseServiceUrl}/internal/courses/by-ids`, {
             cat_ids: course_cat_ids
           }, {
             headers: { 'x-internal-api-key': config.internalApiKey },
             timeout: 10000
           });
           const resolved = parseApiResponse(data);
           if (Array.isArray(resolved)) {
             resolved.forEach(c => courseSet.add(Number(c.id)));
           }
         } catch (e) {
            logger.warn(`[orders] membership unenroll: failed to resolve categories: ${e.message}`);
         }
       }

       for (const cid of courseSet) {
         try {
           await axios.post(`${config.courseServiceUrl}/internal/courses/${cid}/unenroll`, {
             user_id: userId
           }, {
             headers: { 'x-internal-api-key': config.internalApiKey },
             timeout: 5000
           });
         } catch (e) {
            logger.warn(`[orders] membership unenroll: failed for course ${cid}: ${e.message}`);
         }
       }
    } catch (err) {
       logger.warn(`[orders] failed to process membership unenrollment for user ${userId}: ${err.message}`);
    }
  }
}

async function refundOrder(id, { amount, remarks }) {
  return await sequelize.transaction(async (t) => {
    const order = await Order.findOne({
      where: { id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!order) throw new AppError('Order not found', 404);
    const currentStatus = (order.status || '').toLowerCase().trim();
    if (currentStatus !== 'paid' && currentStatus !== 'completed') {
      throw new AppError('Only paid orders can be refunded', 400);
    }

    await order.update(
      {
        status: 'refunded',
        refund_amount: Number(amount) || order.amount,
        refund_remarks: remarks || 'Admin refund',
      },
      { transaction: t }
    );

    // Call revocation logic after status update within the transaction (or just before commit)
    await revokeAccessForOrder(order);

    // Optional: emit outbox event if other services need to know
    await OutboxEvent.create(
      {
        aggregate_type: 'order',
        aggregate_id: order.order_id,
        event_type: 'ORDER_REFUNDED',
        payload: {
          userId: order.user_id,
          orderId: order.order_id,
          type: order.type,
          entityId: order.entity_id,
          refundAmount: amount,
        },
      },
      { transaction: t }
    );

    return order.get({ plain: true });
  });
}

/**
 * Align admin GET/PUT order payloads with list rows: payment_id, buyer_* from linked user when empty, entity_name.
 */
async function enrichAdminOrderResponse(p) {
  if (!p || p.id == null) return p;

  const payment = await Payment.findOne({
    where: { order_id: p.id },
    order: [['id', 'DESC']],
  });

  let user = null;
  if (p.user_id) {
    try {
      const { data: usersBody } = await axios.post(
        `${config.authServiceUrl}/users/internal/list-by-ids`,
        { ids: [p.user_id] },
        { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 5000 }
      );
      const arr =
        usersBody && typeof usersBody === 'object' && usersBody.data !== undefined ? usersBody.data : usersBody;
      if (Array.isArray(arr) && arr.length) {
        user = arr.find((u) => String(u.id) === String(p.user_id)) || arr[0];
      }
    } catch (err) {
      logger.warn(`[orders] enrichAdminOrderResponse user fetch: ${err.message}`);
    }
  }

  let entity_name = null;
  /** Payment-link orders only: what the purchase granted. Null for money-only links. */
  let fulfilment_summary = null;
  const t = (p.type || '').toLowerCase();
  if (t === 'course' && p.entity_id) {
    try {
      const { data: courseRes } = await axios.post(
        `${config.courseServiceUrl}/internal/courses/by-ids`,
        { ids: [String(p.entity_id)], includeUnpublished: true },
        { headers: { 'X-Internal-API-Key': config.internalApiKey } }
      );
      const courses = courseRes.data || courseRes;
      if (Array.isArray(courses) && courses[0]) entity_name = courses[0].title;
    } catch (err) {
      logger.warn(`[orders] enrichAdminOrderResponse course: ${err.message}`);
    }
  } else if (t === 'membership' && p.entity_id) {
    try {
      entity_name = await resolveMembershipPlanDisplayName(p.entity_id);
    } catch (err) {
      logger.warn(`[orders] enrichAdminOrderResponse plan: ${err.message}`);
    }
  } else if (t === 'payment_link' && p.entity_id) {
    try {
      const { data: body, status } = await axios.get(
        `${config.adminServiceUrl}/internal/payment-links/${encodeURIComponent(p.entity_id)}`,
        { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 8000, validateStatus: () => true }
      );
      const payload =
        body && typeof body === 'object' && body.success === true && body.data !== undefined ? body.data : body;
      if (status === 200 && payload && typeof payload === 'object') {
        entity_name = payload.title || payload.name || null;
      }
    } catch (err) {
      logger.warn(`[orders] enrichAdminOrderResponse payment_link: ${err.message}`);
    }

    // What the link actually granted, read off the order's own snapshot rather than
    // the link — support needs to see what *this* buyer got, which is not necessarily
    // what the link sells today.
    const snapshot = parseFulfilment(p);
    if (snapshot && snapshot.product_id) {
      const productType = String(snapshot.product_type || '');
      let productName = null;
      if (productType === 'course') {
        productName = await resolveCourseTitle(snapshot.product_id);
      } else if (productType === 'membership') {
        productName = await resolveMembershipPlanDisplayName(snapshot.product_id);
      }
      fulfilment_summary = {
        product_type: productType,
        product_id: String(snapshot.product_id),
        product_name: productName,
        batch_id: snapshot.batch_id != null ? Number(snapshot.batch_id) : null,
        auto_enroll: snapshot.auto_enroll !== false,
      };
    }
  }

  const paymentId = resolveAdminPaymentId(p, payment);

  return {
    ...p,
    payment_id: paymentId,
    buyer_name: p.buyer_name || (user ? user.name : null),
    buyer_email: p.buyer_email || (user ? user.email : null),
    buyer_mobile: p.buyer_mobile || (user ? user.phone : null),
    entity_name:
      entity_name ||
      p.entity_name ||
      (t === 'membership' ? 'Plan' : t === 'course' ? 'Course' : t === 'payment_link' ? 'Payment link' : null),
    fulfilment_summary,
  };
}

async function getOrderByOrderId(orderId) {
  const order = await Order.findOne({ where: { order_id: orderId } });
  if (!order) return null;
  return enrichAdminOrderResponse(order.get({ plain: true }));
}

const POST_PURCHASE_URL_RE = new RegExp('^https?://', 'i');
const POST_PURCHASE_LINK_TYPES = ['whatsapp', 'zoom', 'telegram', 'link'];
const POST_PURCHASE_MAX_LINKS = 10;
const POST_PURCHASE_DEFAULT_DELAY_SECONDS = 10;

/** Only http(s) survives — these values become `href`/navigation targets on the thank-you page. */
function safeExternalUrl(raw) {
  if (raw == null) return null;
  const url = String(raw).trim();
  return POST_PURCHASE_URL_RE.test(url) ? url : null;
}

/**
 * Several links of one type are alternates, not a list to show at once — a WhatsApp group
 * caps out, so a course lists a few and buyers get spread across them. One per type is
 * surfaced, drawn at random for each receipt; the order of types follows the admin's.
 */
function pickOneLinkPerType(links) {
  const byType = new Map();
  for (const link of links) {
    const bucket = byType.get(link.type);
    if (bucket) bucket.push(link);
    else byType.set(link.type, [link]);
  }
  return [...byType.values()].map(
    (bucket) => bucket[Math.floor(Math.random() * bucket.length)],
  );
}

/**
 * Turns the course's stored post-purchase fields into the shape the thank-you page renders.
 * Returns null when the course has nothing configured, so the page keeps its default behaviour.
 */
function buildPostPurchaseConfig(course) {
  if (!course) return null;

  let parsed = course.post_purchase_links;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      logger.warn('[orders] invalid post_purchase_links JSON on course', {
        courseId: course.id,
        error: err.message,
      });
      parsed = null;
    }
  }

  const configured = (Array.isArray(parsed) ? parsed : [])
    .map((item) => {
      const url = safeExternalUrl(item?.url);
      if (!url) return null;
      const type = POST_PURCHASE_LINK_TYPES.includes(item?.type) ? item.type : 'link';
      const label = String(item?.label || '').trim();
      return { type, label: label || 'Click Here to Join', url };
    })
    .filter(Boolean)
    .slice(0, POST_PURCHASE_MAX_LINKS);
  const links = pickOneLinkPerType(configured);

  const redirectUrl = safeExternalUrl(course.post_purchase_redirect_url);
  if (!links.length && !redirectUrl) return null;

  const rawDelay = Number.parseInt(String(course.post_purchase_redirect_delay ?? ''), 10);
  return {
    links,
    redirectUrl,
    redirectDelaySeconds:
      Number.isFinite(rawDelay) && rawDelay >= 0 ? rawDelay : POST_PURCHASE_DEFAULT_DELAY_SECONDS,
  };
}

async function getInvoice(userId, orderId) {
  const order = await Order.findOne({ where: { order_id: orderId, user_id: userId } });
  if (!order) return null;
  const payment = await Payment.findOne({
    where: { order_id: order.id },
    order: [['id', 'DESC']],
  });
  const p = order.get({ plain: true });

  let itemName = p.type === 'membership' ? 'Membership Plan' : 'Course';
  let itemCategory = '';
  let postPurchase = null;
  try {
    if (p.type === 'course' && p.entity_id) {
      // Internal (not public) endpoint: a buyer's receipt must resolve even for hidden/unpublished courses.
      const { data } = await axios.get(`${config.courseServiceUrl}/internal/courses/${p.entity_id}`, {
        timeout: 5000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      });
      const course = parseApiResponse(data);
      itemName = course?.title || itemName;
      itemCategory = course?.category || '';
      postPurchase = buildPostPurchaseConfig(course);
    } else if (p.type === 'membership' && p.entity_id) {
      const plan = await fetchPlanDetails(p.entity_id);
      itemName = plan?.name || itemName;
      itemCategory = plan?.duration_days ? `${plan.duration_days} days` : '';
    }
  } catch (err) { 
    logger.warn('[orders] getInvoice item name enrichment failed (using defaults)', { error: err.message });
  }

  const isFree = p.gateway === 'free' || Number(p.amount) === 0;
  // The reference to print on the buyer's receipt. Same rule as the admin views
  // (resolveAdminPaymentId): a `manual:` capture ref is an internal placeholder, and for
  // a bulk allotment the real settlement reference lives on the order instead — so fall
  // back to it rather than showing the buyer no transaction ID at all.
  const receiptPaymentId = resolveAdminPaymentId(p, payment);
  const hasRealPayment =
    !!receiptPaymentId &&
    !String(receiptPaymentId).startsWith('manual:') &&
    !String(receiptPaymentId).startsWith('free:');
  return {
    orderId: p.order_id,
    type: p.type,
    entityId: p.entity_id,
    itemName,
    itemCategory,
    /** Join links / redirect for the thank-you page — only once the order is actually paid. */
    postPurchase: p.status === 'paid' ? postPurchase : null,
    originalAmount: p.original_amount,
    couponCode: p.coupon_code,
    couponDiscount: p.coupon_discount,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    paidAt: p.created_at,
    paymentId: !isFree && hasRealPayment ? receiptPaymentId : null,
    paymentMethod: formatPaymentMethodLabel(p.gateway, {
      amount: p.amount,
      hasRazorpayPayment: hasRealPayment,
    }),
    gateway: normalizeOrderGateway(p.gateway) || p.gateway || null,
  };
}

// ─── Coupon listing / apply (for storefront display) ─────────────────────────

async function listActiveCoupons() {
  const now = new Date();
  const coupons = await Coupon.findAll({
    where: {
      status: 'publish',
      visibility: 'public',
      [Op.and]: [
        { [Op.or]: [{ start_date: null }, { start_date: { [Op.lte]: now } }] },
        { [Op.or]: [{ expire_date: null }, { expire_date: { [Op.gte]: now } }] },
      ],
    },
    order: [['created_at', 'DESC']],
  });
  return coupons.map((coupon) => coupon.get({ plain: true }));
}

async function getCouponsForEntity(userId, type, entityId) {
  const typeUpper = normalizeOrderType(type);
  if (!typeUpper && !entityId) {
    return { type: null, entityId: null, amount: null, coupons: await listActiveCoupons() };
  }

  const amount = await resolveAmountForEntity(typeUpper, entityId);
  const now = new Date();
  const coupons = await Coupon.findAll({
    where: {
      status: 'publish',
      [Op.and]: [
        { [Op.or]: [{ start_date: null }, { start_date: { [Op.lte]: now } }] },
        { [Op.or]: [{ expire_date: null }, { expire_date: { [Op.gte]: now } }] },
      ],
    },
    order: [['created_at', 'DESC']],
  });

  const results = coupons
    .filter((coupon) => isDiscountOnAllowedForType(coupon.discount_on, typeUpper))
    .map((coupon) => buildCouponResult(coupon.get({ plain: true }), amount, typeUpper))
    .sort((a, b) => {
      if (b.discountAmount !== a.discountAmount) return b.discountAmount - a.discountAmount;
      return a.min_order - b.min_order;
    });

  return { type: typeUpper, entityId, amount, coupons: results };
}

// applyCoupon — preview only (no usage recorded). Real enforcement is in createOrder.
async function applyCoupon(userId, { couponCode, type, id }) {
  const typeUpper = normalizeOrderType(type);
  const normalizedCode = normalizeCouponCodeInput(couponCode);
  if (!normalizedCode) throw new AppError('Coupon code is required', 400);

  const amount = await resolveAmountForEntity(typeUpper, id);

  const coupon = await findCouponByCode(normalizedCode);
  if (!coupon) throw new AppError('Coupon not found', 404);
  const c = coupon.get({ plain: true });
  const result = buildCouponResult(c, amount, typeUpper);
  throwIfCouponCannotApply(result);

  // Check per-user limit for the preview as well so UI shows accurate state
  const perUserLimit = c.per_user_limit ?? 1;
  if (userId) {
    const userUsed = await CouponUsage.count({ where: { coupon_id: c.id, user_id: userId } });
    if (userUsed >= perUserLimit) {
      throw new AppError('You have already used this coupon', 400);
    }
  }

  return {
    applied: true,
    coupon: {
      id: result.id,
      code: result.code,
      description: result.description,
      type: result.type,
      value: result.value,
      min_order: result.min_order,
      max_discount: result.max_discount,
      discount_on: result.discount_on,
      start_date: result.start_date,
      expire_date: result.expire_date,
      status: result.status,
    },
    amount,
    discount: result.discountAmount,
    payableAmount: result.finalAmount,
  };
}

// ─── Admin Order Management ───────────────────────────────────────────────────

function normalizeAdminPaymentId(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** Create or update a captured payment row for admin manual completion. */
async function ensurePaymentCaptured(orderRow, razorpayPaymentId, { signature = null, source = 'manual', transaction }) {
  const ref = normalizeAdminPaymentId(razorpayPaymentId);
  if (!ref) throw new AppError('Payment ID is required when marking order as paid', 400);

  // Reconcile an existing captured-payment row for this ref against the current
  // order. Same rules whether the row was already present or surfaced by losing
  // an insert race — so this stays correct without a gap-locking read.
  const reconcile = async (existingPay) => {
    if (String(existingPay.order_id) !== String(orderRow.id)) {
      throw new AppError('Payment ID is already linked to another order', 409);
    }
    if (existingPay.status !== 'captured') {
      await existingPay.update(
        {
          status: 'captured',
          razorpay_signature: signature ?? existingPay.razorpay_signature,
          amount: orderRow.amount,
          source,
        },
        { transaction }
      );
    }
    return ref;
  };

  // Non-locking read: MVCC snapshot, takes NO gap lock. The previous
  // `lock: transaction.LOCK.UPDATE` gap-locked the unique razorpay_payment_id
  // index on the not-yet-existing `manual:<orderId>` key, which deadlocked
  // concurrent bulk order creation (all `manual:` keys fall in the same gap).
  const existingPay = await Payment.findOne({
    where: { razorpay_payment_id: ref },
    transaction,
  });
  if (existingPay) return reconcile(existingPay);

  try {
    await Payment.create(
      {
        order_id: orderRow.id,
        razorpay_payment_id: ref,
        razorpay_signature: signature,
        amount: orderRow.amount,
        status: 'captured',
        source,
      },
      { transaction }
    );
    return ref;
  } catch (err) {
    // Lost a race — another transaction inserted the same ref first. Re-read it
    // (locking is safe now: the row exists, so it takes a row lock, not a gap
    // lock) and reconcile against it. Only same-ref concurrency reaches here;
    // distinct `manual:<orderId>` refs from bulk allotment never collide.
    if (err.name === 'SequelizeUniqueConstraintError') {
      const raced = await Payment.findOne({
        where: { razorpay_payment_id: ref },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (raced) return reconcile(raced);
    }
    throw err;
  }
}

async function createManualOrder(data) {
  const {
    user_id,
    type,
    entity_id,
    amount,
    currency = 'INR',
    status = 'pending',
    buyer_name,
    buyer_email,
    buyer_mobile,
    buyer_gst,
    affiliate,
    coupon_code,
    payment_id,
    razorpay_payment_id,
    gateway,
    // Record-only mode: write the order + captured payment, but do not let the
    // order fulfil itself. Used by admin membership allotment, which grants access
    // itself with admin-chosen dates. See emitMembershipRecordOnlyOutbox.
    skip_fulfillment,
    membership_starts_at,
    membership_expires_at,
    // Suppress the membership email. Set when allotting a membership that is already
    // expired on arrival (a historical backfill), where "your membership is active"
    // would be false.
    skip_email,
    // One gateway payment covering many orders (a single settlement for a bulk
    // allotment). See sharedPaymentRef below.
    shared_payment_id,
  } = data;

  const typeUpper = normalizeOrderType(type);
  const skipFulfillment = skip_fulfillment === true;
  const orderId = generateOrderId();
  const paymentRefInput = normalizeAdminPaymentId(payment_id || razorpay_payment_id);
  const resolvedGateway = resolveOrderGateway({
    gateway,
    paymentId: paymentRefInput,
    amount,
  });

  if (status === 'paid' && resolvedGateway === ORDER_GATEWAY.RAZORPAY && !paymentRefInput) {
    throw new AppError('Razorpay Payment ID is required for Razorpay payments', 400);
  }

  /**
   * One real gateway payment can legitimately cover a whole bulk allotment — the admin
   * settles once and allots N users against that single reference. But `payments` is
   * UNIQUE on (razorpay_payment_id, status), which is what stops a real Razorpay payment
   * from being credited to two orders on the checkout path, so it must stay.
   *
   * So in shared mode the reference is recorded on `orders.rp_payment_id` (no unique
   * constraint — this is the natural home for "which settlement did this order come
   * from") while the payments row keeps its own unique `manual:<orderId>` capture ref.
   * Every order still gets a payment row, the reference is still visible on each order,
   * and the checkout-path guard is untouched.
   */
  const sharedPaymentRef = shared_payment_id === true && paymentRefInput ? paymentRefInput : null;

  let resolvedBatchId = null;
  if (typeUpper === 'COURSE') {
    resolvedBatchId = await fetchPurchaseBatchId(entity_id);
  }

  // The list price of the course/plan, for the "original amount" column. A bulk run
  // books hundreds of orders against ONE entity, so the driver resolves this once and
  // passes it down rather than making the same lookup per order. Only a real number is
  // accepted as a pre-resolved value — `null`/`''` would otherwise coerce to a ₹0 list
  // price and silently misreport every order in the run.
  let originalAmount = 0;
  if (typeof data.original_amount === 'number' && Number.isFinite(data.original_amount)) {
    originalAmount = data.original_amount;
  } else {
    try {
      originalAmount = await resolveAmountForEntity(typeUpper, entity_id);
    } catch (e) {
      logger.warn(`Could not resolve original amount for ${typeUpper} ${entity_id}: ${e.message}`);
    }
  }

  let couponResult = null;
  if (coupon_code && String(coupon_code).trim()) {
    try {
      couponResult = await validateCouponForOrder(user_id, coupon_code, originalAmount, typeUpper);
    } catch (err) {
      logger.warn(`Manual order coupon validation failed: ${err.message}`);
    }
  }

  const createdOrder = await withDeadlockRetry(() => sequelize.transaction(async (t) => {
    const created = await Order.create(
      {
        order_id: orderId,
        user_id: user_id || null,
        type: typeUpper.toLowerCase(),
        entity_id: String(entity_id),
        batch_id: resolvedBatchId,
        amount: Number(amount) || 0,
        currency,
        buyer_name: buyer_name || null,
        buyer_email: buyer_email || null,
        buyer_mobile: buyer_mobile || null,
        buyer_gst: buyer_gst || null,
        rp_payment_id: sharedPaymentRef,
        status: status,
        affiliate: normalizeReferralForOrder(affiliate),
        gateway: resolvedGateway,
        coupon_code: couponResult ? couponResult.coupon.code : (coupon_code || null),
        coupon_discount: couponResult ? couponResult.discountAmount : 0,
        original_amount: originalAmount,
        utm: data.utm || null,
      },
      { transaction: t }
    );

    const locked = await Order.findOne({
      where: { id: created.id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (status === 'paid') {
      // In shared mode the real reference lives on the order, so the payment row takes a
      // per-order ref and one settlement can back the whole allotment without colliding.
      const adminPaymentRef =
        (sharedPaymentRef ? null : paymentRefInput) || `manual:${orderId}`;
      await ensurePaymentCaptured(locked, adminPaymentRef, { source: 'manual', transaction: t });

      if (skipFulfillment && locked.type === 'membership') {
        // The record-only event exists solely to send the membership email — it grants
        // nothing. With the email suppressed there is nothing left to emit.
        if (skip_email !== true) {
          await emitMembershipRecordOnlyOutbox(locked, t, {
            startsAt: membership_starts_at,
            expiresAt: membership_expires_at,
          });
        }
      } else if (skipFulfillment && locked.type === 'course') {
        // Record-only course order. Emitted nothing on purpose: the learner already has
        // the course — allotment phase 1 enrolled them, or this is a backfill of an order
        // that failed after they were enrolled — so emitPurchaseOutbox would re-grant
        // access and send a second "you have access" email for something they already own.
      } else {
        await emitPurchaseOutbox(locked, t, { isManual: true });
        // Membership orders already get their own email via MEMBERSHIP_ACTIVATED (emitPurchaseOutbox above).
        if (locked.type === 'course') {
          await emitCourseAccessEmailOutbox(locked, t);
        }
      }
      if (couponResult) {
        await recordCouponUsage(couponResult.coupon.id, user_id, orderId, t);
      }
    }

    return locked;
  }), { label: 'createManualOrder' });

  return createdOrder.get({ plain: true });
}

/**
 * Bulk order creation for admin allotment (course enrolment and membership alike).
 *
 * Runs the SAME createManualOrder path for each user at a bounded concurrency, so
 * a large allotment (1000+ users) is created as one chunked call at controlled load
 * instead of a storm of per-user HTTP calls (the pattern that overloaded and crashed
 * order-service). Every order/payment/outbox row is therefore byte-identical to a
 * single allotment — only the driver changes.
 *
 * Amount and payment_id are per user, falling back to the request-level `amount` when
 * a row omits its own. A row without a payment_id gets its own unique `manual:<orderId>`
 * capture ref. By default `payments` is unique on (razorpay_payment_id, status), so a
 * repeated id fails only its own row (409) and is reported back rather than thrown; pass
 * `shared_payment_id` when one settlement legitimately covers the whole run and the same
 * reference should be accepted on every order. Never throws for one user; returns a
 * per-user result so the caller can report partials.
 *
 * The entity's list price is resolved ONCE here rather than per order: every row in a
 * bulk run targets the same course/plan, so the per-order lookup was N identical calls.
 *
 * @param {object} p
 * @param {'course'|'membership'} [p.type]  order type (default 'course')
 * @param {string|number} p.entity_id       course id, or plan id/slug for membership
 * @param {number} [p.amount]               fallback per-order amount (0 = free)
 * @param {string} [p.status]               order status (default 'paid')
 * @param {boolean} [p.skip_fulfillment]    record-only (membership or course allotment); see createManualOrder
 * @param {boolean} [p.shared_payment_id]   allow one payment reference across every order
 * @param {boolean} [p.skip_email]          suppress the membership email (expired backfill)
 * @param {string} [p.membership_starts_at] membership start, for the record-only email
 * @param {string} [p.membership_expires_at] membership expiry, for the record-only email
 * @param {Array<{user_id:number, buyer_name?:string, buyer_email?:string, buyer_mobile?:string, amount?:number, payment_id?:string}>} p.users
 * @returns {Promise<Array<{user_id:number, ok:boolean, order_id?:string, error?:string}>>}
 */
async function createManualOrdersBulk({
  type = 'course',
  entity_id,
  amount = 0,
  status = 'paid',
  users = [],
  skip_fulfillment = false,
  shared_payment_id = false,
  skip_email = false,
  membership_starts_at,
  membership_expires_at,
}) {
  const list = Array.isArray(users) ? users : [];
  if (list.length === 0) return [];
  const CONCURRENCY = 5;

  let originalAmount;
  try {
    originalAmount = await resolveAmountForEntity(normalizeOrderType(type), entity_id);
  } catch (e) {
    logger.warn(`[orders] bulk could not resolve original amount for ${type} ${entity_id}: ${e.message}`);
  }

  const results = new Array(list.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (cursor < list.length) {
      const i = cursor;
      cursor += 1;
      const u = list[i] || {};
      const userId = u.user_id;
      try {
        const order = await createManualOrder({
          user_id: userId,
          type,
          entity_id,
          amount: u.amount != null ? u.amount : amount,
          status,
          buyer_name: u.buyer_name != null ? u.buyer_name : null,
          buyer_email: u.buyer_email != null ? u.buyer_email : null,
          buyer_mobile: u.buyer_mobile != null ? u.buyer_mobile : null,
          payment_id: u.payment_id || undefined,
          original_amount: originalAmount,
          skip_fulfillment,
          shared_payment_id,
          skip_email,
          membership_starts_at,
          membership_expires_at,
        });
        results[i] = { user_id: userId, ok: true, order_id: order.order_id };
      } catch (err) {
        logger.warn(`[orders] bulk ${type} order failed user=${userId} entity=${entity_id}: ${err.message}`);
        results[i] = { user_id: userId, ok: false, error: err.message || 'order_failed' };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

/** Course-allotment driver — kept as a named entry point for the existing route. */
function createManualCourseOrdersBulk(params) {
  return createManualOrdersBulk({ ...params, type: 'course' });
}

async function updateOrder(id, data) {
  const plain = await sequelize.transaction(async (t) => {
    const order = await Order.findOne({
      where: { id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!order) return null;

    const oldPlain = order.get({ plain: true });
    const oldStatus = (order.status || '').toLowerCase().trim();
    const fulfilledBefore = oldStatus === 'paid' || oldStatus === 'completed';

    const orderType = (order.type || '').toLowerCase();
    let entityChanged = false;

    // Admin may switch course/plan (same order.type only — never change type here).
    if (data.entity_id !== undefined && data.entity_id !== null && String(data.entity_id).trim() !== '') {
      const newEid = String(data.entity_id).trim();
      const oldEid = order.entity_id != null ? String(order.entity_id) : '';
      if (newEid !== oldEid) {
        if (orderType !== 'course' && orderType !== 'membership') {
          throw new AppError('Entity can only be changed for course or membership orders', 400);
        }
        entityChanged = true;

        // Critical: remove fulfillment for the previous course/plan before re-pointing the order.
        if (fulfilledBefore && order.user_id) {
          logger.info(
            `[orders] admin entity swap — revoking prior access order=${order.order_id} oldEntity=${oldEid} newEntity=${newEid}`
          );
          await revokeAccessForOrder(oldPlain);
        }

        order.entity_id = newEid;

        if (orderType === 'course') {
          if (data.batch_id !== undefined && data.batch_id !== null && data.batch_id !== '') {
            order.batch_id = Number(data.batch_id);
          } else {
            order.batch_id = await fetchPurchaseBatchId(newEid);
          }
        }
      }
    }

    if (
      !entityChanged &&
      data.batch_id !== undefined &&
      orderType === 'course'
    ) {
      order.batch_id =
        data.batch_id === null || data.batch_id === '' ? null : Number(data.batch_id);
    }

    const updatableFields = [
      'buyer_name',
      'buyer_email',
      'buyer_mobile',
      'buyer_gst',
      'amount',
      'utm',
      'refund_amount',
      'refund_remarks',
    ];
    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        order[field] = data[field];
      }
    }

    if (data.coupon_code !== undefined) {
      order.coupon_code = data.coupon_code === '' || data.coupon_code === null ? null : String(data.coupon_code).trim();
    }
    if (data.coupon_discount !== undefined) {
      const v = data.coupon_discount;
      order.coupon_discount =
        v === '' || v === null ? 0 : Number(v);
    }
    if (data.original_amount !== undefined) {
      const v = data.original_amount;
      order.original_amount = v === '' || v === null ? null : Number(v);
    }

    if (data.affiliate !== undefined) {
      order.affiliate = normalizeReferralForOrder(data.affiliate);
    }

    if (data.gateway !== undefined) {
      const normalizedGateway = normalizeOrderGateway(data.gateway);
      if (normalizedGateway) {
        order.gateway = normalizedGateway;
      }
    }

    let newStatus = oldStatus;
    if (data.status !== undefined) {
      order.status = data.status;
      newStatus = String(data.status).toLowerCase().trim();
    }

    await order.save({ transaction: t });

    let reloaded = await Order.findOne({
      where: { id: order.id },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (data.amount !== undefined && reloaded) {
      const pay = await Payment.findOne({
        where: { order_id: reloaded.id },
        order: [['id', 'DESC']],
        transaction: t,
      });
      if (pay && pay.status === 'captured') {
        await pay.update({ amount: reloaded.amount }, { transaction: t });
      }
    }

    const fulfilledAfter =
      newStatus === 'paid' || newStatus === 'completed';
    const notCancelledLike =
      newStatus !== 'refunded' &&
      newStatus !== 'failed' &&
      newStatus !== 'cancelled';

    const adminPaymentRef = normalizeAdminPaymentId(data.payment_id || data.razorpay_payment_id);

    // First transition to paid (manual fulfillment path).
    if (
      newStatus === 'paid' &&
      oldStatus !== 'paid' &&
      oldStatus !== 'completed'
    ) {
      const resolvedGateway = resolveOrderGateway({
        gateway: data.gateway ?? order.gateway,
        paymentId: adminPaymentRef,
        amount: reloaded.amount,
      });
      order.gateway = resolvedGateway;
      await order.save({ transaction: t });
      reloaded = await Order.findOne({
        where: { id: order.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (resolvedGateway === ORDER_GATEWAY.RAZORPAY && !adminPaymentRef) {
        throw new AppError(
          'Razorpay Payment ID is required when marking an order as paid via Razorpay',
          400
        );
      }
      const paymentRef = adminPaymentRef || `manual:${reloaded.order_id}`;
      await ensurePaymentCaptured(reloaded, paymentRef, { source: 'manual', transaction: t });
      await emitPurchaseOutbox(reloaded, t, { isManual: true });
      // Membership orders already get their own email via MEMBERSHIP_ACTIVATED (emitPurchaseOutbox above).
      if (reloaded.type === 'course') {
        await emitCourseAccessEmailOutbox(reloaded, t);
      }
    } else if (
      adminPaymentRef &&
      (newStatus === 'paid' || newStatus === 'completed') &&
      (oldStatus === 'paid' || oldStatus === 'completed')
    ) {
      // Update payment reference on an already-paid order without re-fulfilling.
      await ensurePaymentCaptured(reloaded, adminPaymentRef, { source: 'manual', transaction: t });
    }

    // Paid/completed order had item swapped: grant new course/plan without duplicate affiliate commission.
    if (
      entityChanged &&
      fulfilledAfter &&
      notCancelledLike &&
      fulfilledBefore
    ) {
      logger.info(
        `[orders] admin entity swap — re-emit fulfillment order=${reloaded.order_id} entity=${reloaded.entity_id}`
      );
      await emitPurchaseOutbox(reloaded, t, { skipAffiliate: true, isManual: true });
    }

    if (newStatus === 'refunded' && oldStatus !== 'refunded') {
      if (reloaded.user_id) {
        await revokeAccessForOrder(reloaded.get({ plain: true }));
      }
      const patch = {};
      if (
        (data.refund_amount === undefined || data.refund_amount === null) &&
        !reloaded.refund_amount
      ) {
        patch.refund_amount = Number(reloaded.amount);
      }
      if (
        (data.refund_remarks === undefined || data.refund_remarks === null) &&
        !reloaded.refund_remarks
      ) {
        patch.refund_remarks = 'Admin refund (order edit)';
      }
      if (Object.keys(patch).length) {
        await reloaded.update(patch, { transaction: t });
        reloaded = await Order.findOne({
          where: { id: reloaded.id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
      }

      const refundAmt =
        reloaded.refund_amount != null ? Number(reloaded.refund_amount) : Number(reloaded.amount);
      await OutboxEvent.create(
        {
          aggregate_type: 'order',
          aggregate_id: reloaded.order_id,
          event_type: 'ORDER_REFUNDED',
          payload: {
            userId: reloaded.user_id,
            orderId: reloaded.order_id,
            type: reloaded.type,
            entityId: reloaded.entity_id,
            refundAmount: refundAmt,
          },
        },
        { transaction: t }
      );
    }

    return reloaded.get({ plain: true });
  });
  if (!plain) return null;
  return enrichAdminOrderResponse(plain);
}

async function deleteOrder(id) {
  const order = await Order.findByPk(id);
  if (!order) return null;
  await order.destroy();
  logger.info(`[orders] moved to trash id=${id} order_id=${order.order_id}`);
  return { id };
}

async function restoreOrder(id) {
  const order = await Order.findByPk(id, { paranoid: false });
  if (!order || !order.deleted_at) return null;
  await order.restore();
  logger.info(`[orders] restored from trash id=${id} order_id=${order.order_id}`);
  return { id };
}

/**
 * Permanently delete an order and its owned rows (payments + coupon-usage).
 * Only orders already in trash can be hard-deleted, so a single call can never
 * destroy a live order. Payments key off the numeric order id; coupon-usage
 * rows key off the public order_id string. Returns { ok: true } on success or
 * { ok: false, reason } when the order is missing or not in trash.
 *
 * Course/batch enrollments have no FK to orders, so hard-deleting an order
 * that a user is still enrolled/granted access via silently orphans that
 * enrollment (nothing else ever points back to say "this access came from
 * an order that no longer exists"). Refuse by default when a live enrollment
 * still traces to this order's course; pass force:true to delete anyway.
 */
async function deleteOrderPermanently(id, { force = false } = {}) {
  const order = await Order.findByPk(id, { paranoid: false });
  if (!order) return { ok: false, reason: 'not_found' };
  if (!order.deleted_at) return { ok: false, reason: 'not_trashed' };

  if (!force && order.type === 'course' && order.user_id) {
    const cid = Number(order.entity_id);
    if (Number.isFinite(cid) && cid > 0) {
      const enrolledCourseIds = await fetchUserEnrolledCourseIds(order.user_id);
      if (enrolledCourseIds.has(cid)) {
        return { ok: false, reason: 'active_enrollment_exists' };
      }
    }
  }

  await sequelize.transaction(async (t) => {
    await Payment.destroy({ where: { order_id: order.id }, transaction: t });
    if (order.order_id) {
      await CouponUsage.destroy({ where: { order_id: order.order_id }, transaction: t });
    }
    await order.destroy({ force: true, transaction: t });
  });

  logger.info(`[orders] permanently deleted from trash id=${id} order_id=${order.order_id}`);
  return { ok: true };
}

// ─── Admin coupon CRUD ────────────────────────────────────────────────────────

async function listAllCoupons() {
  const coupons = await Coupon.findAll({ order: [['created_at', 'DESC']] });
  return coupons.map((c) => c.get({ plain: true }));
}

async function createCoupon(data) {
  const coupon = await Coupon.create(data);
  return coupon.get({ plain: true });
}

async function updateCoupon(id, data) {
  const coupon = await Coupon.findByPk(id);
  if (!coupon) return null;
  await coupon.update(data);
  return coupon.get({ plain: true });
}

async function deleteCoupon(id) {
  const coupon = await Coupon.findByPk(id);
  if (!coupon) return null;
  await coupon.destroy();
  return { id };
}

module.exports = {
  createOrder,
  verifyOrder,
  completePayment,
  captureRazorpayPayment,
  emitPaymentEmailOutbox,
  emitCourseAccessEmailOutbox,
  createPaymentLinkOrder,
  verifyPaymentLinkOrder,
  listOrders,
  listMyPurchases,
  getInvoice,
  getEnrollmentSources,
  listAllOrders,
  listCouponUsages,
  getCouponUsageSummary,
  getOrderByOrderId,
  getCouponsForEntity,
  applyCoupon,
  listActiveCoupons,
  listAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  createManualOrder,
  createManualOrdersBulk,
  createManualCourseOrdersBulk,
  updateOrder,
  deleteOrder,
  restoreOrder,
  deleteOrderPermanently,
  refundOrder,
  validateCouponForPreview,
  getOrderStats,
  getRevenueTimeSeries,
};

/**
 * Returns revenue + enrollment counts grouped by time bucket.
 * bucket: 'day' → one row per calendar day (7d view)
 *         'week' → one row per ISO week (30d view)
 *         'month' → one row per calendar month (90d view)
 */
async function getRevenueTimeSeries({ dateFrom, dateTo, bucket = 'day' } = {}) {
  const groupExpr =
    bucket === 'month'
      ? "DATE_FORMAT(created_at, '%Y-%m')"
      : bucket === 'week'
      ? "DATE_FORMAT(created_at, '%Y-%u')"
      : 'DATE(created_at)';

  const labelExpr =
    bucket === 'month'
      ? "DATE_FORMAT(created_at, '%b')"
      : bucket === 'week'
      ? "CONCAT('Week ', WEEK(created_at, 3) - WEEK(MIN(created_at) OVER(), 3) + 1)"
      : "DATE_FORMAT(created_at, '%a')";

  const start = resolveFilterRangeStart(dateFrom);
  const end = resolveFilterRangeEnd(dateTo);

  const replacements = [];
  let whereSql = "WHERE status = 'paid'";
  if (start && !Number.isNaN(start.getTime())) {
    whereSql += ' AND created_at >= ?';
    replacements.push(start);
  }
  if (end && !Number.isNaN(end.getTime())) {
    whereSql += ' AND created_at <= ?';
    replacements.push(end);
  }

  const rows = await sequelize.query(
    `SELECT
       ${groupExpr} AS bucket,
       DATE_FORMAT(MIN(created_at), '%b %d') AS label,
       COALESCE(SUM(amount), 0) AS revenue,
       COUNT(*) AS enrollments
     FROM orders
     ${whereSql}
     GROUP BY ${groupExpr}
     ORDER BY MIN(created_at) ASC`,
    { replacements, type: QueryTypes.SELECT }
  );

  return rows.map((r, i) => ({
    label: bucket === 'day'
      ? new Date(r.bucket).toLocaleDateString('en-IN', { weekday: 'short' })
      : bucket === 'week'
      ? `Week ${i + 1}`
      : new Date(r.bucket + '-01').toLocaleDateString('en-IN', { month: 'short' }),
    revenue: parseFloat(r.revenue),
    enrollments: parseInt(r.enrollments, 10),
  }));
}

/**
 * Returns aggregated order stats (count + revenue) for a date range.
 * Only counts orders with status = 'paid'.
 */
async function getOrderStats({ dateFrom, dateTo } = {}) {
  const where = { status: 'paid' };
  applyCreatedAtRangeToWhere(where, dateFrom, dateTo);
  const result = await Order.findOne({
    where,
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_orders'],
      [sequelize.fn('SUM', sequelize.col('amount')), 'total_revenue'],
    ],
    raw: true,
  });
  return {
    total_orders: parseInt(result?.total_orders || 0, 10),
    total_revenue: parseFloat(result?.total_revenue || 0),
  };
}

/**
 * Validate a coupon for preview / summary purposes only — no usage recorded.
 * Used by platform-service upgrade-summary endpoint.
 * Returns { couponCode, discountAmount, afterDiscount } or null.
 */
async function validateCouponForPreview(userId, couponCode, amount, type) {
  const typeUpper = normalizeOrderType(type);
  const result = await validateCouponForOrder(userId, couponCode, amount, typeUpper);
  if (!result) return null;
  const { coupon, discountAmount, finalAmount } = result;
  const plain = coupon.get ? coupon.get({ plain: true }) : coupon;
  return {
    couponCode: plain.code,
    discountAmount: Number(discountAmount.toFixed(2)),
    afterDiscount: Number(finalAmount.toFixed(2)),
  };
}
