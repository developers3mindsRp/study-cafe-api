const crypto = require('crypto');
const axios = require('axios');
const { sequelize, Order, Payment, OutboxEvent, Coupon, CouponUsage } = require('../models');
const { Op } = require('sequelize');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getRazorpayInstance, getRazorpayConfig } = require('./payment.service');
const { AppError, logger, computeMembershipUpgradeCredit } = require('../../../../shared');

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

// ─── Internal service helpers ─────────────────────────────────────────────────

async function fetchPlanDetails(entityId) {
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
  } catch {
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
  } catch {
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
  } catch {
    return null;
  }
}

function buildMembershipPayload(order, plan) {
  const now = new Date();
  const payload = { userId: order.user_id, orderId: order.order_id };

  if (plan && plan.is_lifetime) {
    const farFuture = new Date(now);
    farFuture.setFullYear(farFuture.getFullYear() + 100);
    payload.membershipType = plan.slug || 'lifetime';
    payload.startsAt = now.toISOString();
    payload.expiresAt = farFuture.toISOString();
  } else if (plan && plan.duration_days) {
    payload.membershipType = plan.slug || 'basic';
    payload.startsAt = now.toISOString();
    const expires = new Date(now.getTime() + plan.duration_days * 86400000);
    payload.expiresAt = expires.toISOString();
  } else {
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 1);
    payload.membershipType = 'annual';
    payload.startsAt = now.toISOString();
    payload.expiresAt = expires.toISOString();
  }
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
  } catch {
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
  } catch {
    return null;
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

function buildCouponResult(coupon, amount, typeUpper) {
  const now = new Date();
  const startDate = coupon.start_date ? new Date(coupon.start_date) : null;
  const expireDate = coupon.expire_date ? new Date(coupon.expire_date) : null;
  const published = coupon.status === 'publish';
  const validType = isCouponTypeValid(coupon, typeUpper);
  const meetsMinOrder = amount >= parseAmount(coupon.min_order);
  const dateValid = (!startDate || now >= startDate) && (!expireDate || now <= expireDate);
  const discountAmount = calculateDiscount(coupon, amount);
  const finalAmount = Number((amount - discountAmount).toFixed(2));
  const canApply = published && validType && dateValid && meetsMinOrder;
  let inactiveReason = null;

  if (!validType) {
    inactiveReason = 'Coupon not applicable for selected type';
  } else if (!published) {
    inactiveReason = 'Coupon is not published';
  } else if (!dateValid) {
    inactiveReason = startDate && now < startDate ? 'Coupon not active yet' : 'Coupon has expired';
  } else if (!meetsMinOrder) {
    inactiveReason = `Minimum order value ₹${parseAmount(coupon.min_order)} required`;
  }

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
    inactiveReason,
  };
}

/**
 * Validate a coupon server-side for a specific user + purchase.
 * Returns { coupon, discountAmount, finalAmount } or throws AppError.
 * Does NOT record usage — call recordCouponUsage() after order is created.
 */
async function validateCouponForOrder(userId, couponCode, amount, typeUpper) {
  const normalizedCode = String(couponCode || '').trim().toLowerCase();
  if (!normalizedCode) return null;

  const coupon = await Coupon.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('code')), normalizedCode),
  });
  if (!coupon) throw new AppError('Coupon not found', 404);

  const c = coupon.get({ plain: true });
  const result = buildCouponResult(c, amount, typeUpper);
  if (!result.canApply) {
    throw new AppError(`Coupon cannot be applied: ${result.inactiveReason}`, 400);
  }

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
  const userUsed = await CouponUsage.count({ where: { coupon_id: c.id, user_id: userId } });
  if (userUsed >= perUserLimit) {
    throw new AppError('You have already used this coupon', 400);
  }

  return { coupon, discountAmount: result.discountAmount, finalAmount: result.finalAmount };
}

async function recordCouponUsage(couponId, userId, orderId, transaction) {
  await CouponUsage.create(
    { coupon_id: couponId, user_id: userId, order_id: orderId },
    { transaction }
  );
}

/** Outbox: enrollment / membership + affiliate (only when order amount &gt; 0). */
async function emitPurchaseOutbox(locked, t) {
  const oid = locked.order_id;
  const existingCourseIds = await fetchUserEnrolledCourseIds(locked.user_id);

  if (locked.type === 'course') {
    const cid = Number(locked.entity_id);
    if (Number.isFinite(cid) && cid > 0 && existingCourseIds.has(cid)) {
      logger.info(
        `[orders] skip COURSE_PURCHASED (already enrolled) user=${locked.user_id} course=${cid} order=${oid}`
      );
    } else {
      await OutboxEvent.create(
        {
          aggregate_type: 'order',
          aggregate_id: oid,
          event_type: 'COURSE_PURCHASED',
          payload: {
            userId: locked.user_id,
            orderId: oid,
            courseId: locked.entity_id,
            batchId: locked.batch_id ? Number(locked.batch_id) : null,
          },
        },
        { transaction: t }
      );
    }
  } else if (locked.type === 'membership') {
    const plan = await fetchPlanDetails(locked.entity_id);
    const payload = buildMembershipPayload(locked, plan);
    await OutboxEvent.create(
      {
        aggregate_type: 'order',
        aggregate_id: oid,
        event_type: 'MEMBERSHIP_ACTIVATED',
        payload,
      },
      { transaction: t }
    );

    // Auto-assign courses linked to this membership plan
    const { course_ids = [], course_cat_ids = [] } = await fetchPlanLinkedCourses(locked.entity_id);

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
        logger.warn(`[orders] failed to resolve course categories for plan ${locked.entity_id}: ${err.message}`);
      }
    }

    // 3. Emit COURSE_PURCHASED for each linked course (skip if user already has access — e.g. prior standalone purchase)
    for (const cid of courseSet) {
      const courseNum = Number(cid);
      if (Number.isFinite(courseNum) && courseNum > 0 && existingCourseIds.has(courseNum)) {
        logger.info(
          `[orders] skip membership-linked COURSE_PURCHASED (already enrolled) user=${locked.user_id} course=${courseNum} order=${oid}`
        );
        continue;
      }
      // We resolve batch synchronously for EACH course to ensure consistency
      const batchId = await fetchPurchaseBatchId(cid);
      await OutboxEvent.create(
        {
          aggregate_type: 'order',
          aggregate_id: oid,
          event_type: 'COURSE_PURCHASED',
          payload: {
            userId: locked.user_id,
            orderId: oid,
            courseId: String(cid),
            batchId: batchId ? Number(batchId) : null,
            isMembershipLinked: true,
          },
        },
        { transaction: t }
      );
    }
  }

  const orderAmt = parseFloat(locked.amount);
  if (locked.affiliate && Number.isFinite(orderAmt) && orderAmt > 0) {
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

// ─── completePayment ──────────────────────────────────────────────────────────
// Called by both checkout verify and webhook. Uses SELECT … FOR UPDATE to
// prevent a double-payment race when verify + webhook arrive simultaneously.

async function completePayment(order, razorpayPaymentId, { signature = null, source = 'checkout' } = {}) {
  try {
    return await sequelize.transaction(async (t) => {
      const locked = await Order.findOne({
        where: { id: order.id },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      if (!locked || locked.status === 'paid') {
        return { alreadyPaid: true, message: 'Already paid' };
      }

      await locked.update({ status: 'paid' }, { transaction: t });

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
      return { verified: true };
    });
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

// ─── createOrder ─────────────────────────────────────────────────────────────
// SECURITY: Always fetches price from backend. Client-supplied `amount` is IGNORED.
// Coupon is validated server-side and discount recorded on the order row.

async function createOrder(userId, { type, entityId, couponCode, referralCode, currency = 'INR', utm, buyer_name, buyer_email, buyer_mobile }) {
  const typeUpper = normalizeOrderType(type);

  // 1. Fetch canonical price from the owning service — never trust client
  const originalAmount = await resolveAmountForEntity(typeUpper, entityId);

  // 1b. Membership upgrade guard — enforce one-active-membership and upgrade-only direction
  let upgradeDeduction = 0;
  if (typeUpper === 'MEMBERSHIP') {
    const [newPlan, activeMembership] = await Promise.all([
      fetchPlanDetails(entityId),
      fetchUserActiveMembership(userId),
    ]);

    if (activeMembership) {
      // Resolve the sort_order of the currently active plan via its slug
      const activePlan = await fetchPlanBySlug(activeMembership.membership_type);
      const activeOrder = activePlan ? Number(activePlan.sort_order ?? 0) : 0;
      const newOrder = newPlan ? Number(newPlan.sort_order ?? 0) : 0;

      if (newOrder <= activeOrder) {
        const activeName = activePlan ? activePlan.name : activeMembership.membership_type;
        const newName = newPlan ? newPlan.name : String(entityId);
        throw new AppError(
          `You already have an active "${activeName}" membership. You can only upgrade to a higher tier, not purchase "${newName}".`,
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

  // 4. Guard: idempotency lock per (user, type, entity) — prevents race-created duplicates
  const lockKey = `order:lock:${userId}:${typeUpper}:${entityId}`;
  const redis = await getRedis();
  const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 30 });
  if (!gotLock) throw new AppError('Duplicate order in progress', 429);

  const orderId = generateOrderId();
  const amountPaise = Math.round(grandTotal * 100);

  let resolvedBatchId = null;
  if (typeUpper === 'COURSE') {
    resolvedBatchId = await fetchPurchaseBatchId(entityId);
  }

  try {
    if (grandTotal <= 0) {
      const contact = await fetchUserContact(userId);
      await sequelize.transaction(async (t) => {
        const created = await Order.create(
          {
            order_id: orderId,
            user_id: userId,
            type: typeUpper.toLowerCase(),
            entity_id: String(entityId),
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
        const locked = await Order.findOne({
          where: { id: created.id },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (!locked) throw new AppError('Order not found after create', 500);
        await locked.update({ status: 'paid' }, { transaction: t });
        const freeRef = `free:${orderId}`;
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
        if (couponResult) {
          await recordCouponUsage(couponResult.coupon.id, userId, orderId, t);
        }
      });
      await redis.del(lockKey);
      return {
        orderId,
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

    const order = await Order.create({
      order_id: orderId,
      user_id: userId,
      type: typeUpper.toLowerCase(),
      entity_id: String(entityId),
      batch_id: resolvedBatchId,
      original_amount: originalAmount,
      coupon_code: couponResult ? couponResult.coupon.code : null,
      coupon_discount: discountAmount,
      amount: grandTotal,
      currency,
      status: 'pending',
      affiliate: normalizeReferralForOrder(referralCode),
      utm,
      buyer_name,
      buyer_email,
      buyer_mobile,
    });

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency,
      receipt: orderId,
      notes: {
        orderId,
        userId: String(userId),
        type: typeUpper,
        entityId: String(entityId),
      },
    });

    await order.update({ razorpay_order_id: rpOrder.id });

    if (couponResult) {
      await recordCouponUsage(couponResult.coupon.id, userId, orderId, null);
    }

    await redis.del(lockKey);

    const rpConfig = await getRazorpayConfig();
    const contact = await fetchUserContact(userId);

    return {
      orderId,
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

  const discountAmount = 0;
  const afterDiscount = salePrice;
  const gstAmount = Number((afterDiscount * GST_RATE).toFixed(2));
  const grandTotal = Number((afterDiscount + gstAmount).toFixed(2));

  const lockKey = `order:lock:pl:${paymentLinkId}:${email.toLowerCase()}`;
  const redis = await getRedis();
  const gotLock = await redis.set(lockKey, '1', { NX: true, EX: 45 });
  if (!gotLock) throw new AppError('Duplicate order in progress', 429);

  const orderId = generateOrderId();
  const amountPaise = Math.round(grandTotal * 100);

  try {
    if (grandTotal <= 0) {
      await sequelize.transaction(async (t) => {
        const created = await Order.create(
          {
            order_id: orderId,
            user_id: userId || null,
            type: 'payment_link',
            entity_id: String(paymentLinkId),
            batch_id: null,
            original_amount: listAmount,
            coupon_code: null,
            coupon_discount: 0,
            amount: grandTotal,
            currency: 'INR',
            status: 'pending',
            affiliate: normalizeReferralForOrder(body.referralCode),
            gateway: 'free',
            buyer_name: fullName,
            buyer_email: email,
            buyer_mobile: mobile,
            buyer_gst: gstNumber,
          },
          { transaction: t }
        );
        const locked = await Order.findOne({
          where: { id: created.id },
          lock: t.LOCK.UPDATE,
          transaction: t,
        });
        if (!locked) throw new AppError('Order not found after create', 500);
        await locked.update({ status: 'paid' }, { transaction: t });
        const freeRef = `free:${orderId}`;
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
      });
      await redis.del(lockKey);
      const rpConfig = await getRazorpayConfig();
      return {
        orderId,
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

    const order = await Order.create({
      order_id: orderId,
      user_id: userId || null,
      type: 'payment_link',
      entity_id: String(paymentLinkId),
      batch_id: null,
      original_amount: listAmount,
      coupon_code: null,
      coupon_discount: discountAmount,
      amount: grandTotal,
      currency: 'INR',
      status: 'pending',
      affiliate: normalizeReferralForOrder(body.referralCode),
      buyer_name: fullName,
      buyer_email: email,
      buyer_mobile: mobile,
      buyer_gst: gstNumber,
      utm: body.utm || null,
    });

    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: orderId,
      notes: {
        orderId,
        userId: userId != null ? String(userId) : '',
        type: 'PAYMENT_LINK',
        entityId: String(paymentLinkId),
      },
    });

    await order.update({ razorpay_order_id: rpOrder.id });

    await redis.del(lockKey);

    const rpConfig = await getRazorpayConfig();

    return {
      orderId,
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

async function listOrders(userId) {
  console.log('USER ID:', userId);
  const rows = await Order.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    attributes: ['order_id', 'type', 'entity_id', 'amount', 'currency', 'status', 'created_at'],
  });
  console.log('ORDERS:', rows);
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

async function listMyPurchases(userId) {
  const courseCache = new Map();
  async function fetchCourseForOrder(entityId) {
    if (!entityId) return null;
    const key = String(entityId);
    if (courseCache.has(key)) return courseCache.get(key);
    try {
      const { data } = await axios.get(`${config.courseServiceUrl}/courses/${key}`, {
        timeout: 8000,
        validateStatus: (s) => s === 200,
      });
      const payload = data.data !== undefined ? data.data : data;
      courseCache.set(key, payload);
      return payload;
    } catch {
      courseCache.set(key, null);
      return null;
    }
  }

  // Only return fully paid orders — pending/failed orders (incomplete payments) are excluded
  const rows = await Order.findAll({
    where: { user_id: userId, status: 'paid' },
    order: [['created_at', 'DESC']],
  });
  const out = [];
  const courseEntityIds = [];
  for (const row of rows) {
    const o = row.get({ plain: true });
    const payment = await Payment.findOne({
      where: { order_id: o.id },
      order: [['id', 'DESC']],
    });
    let course = null;
    if (o.type === 'course' && o.entity_id) {
      courseEntityIds.push(Number(o.entity_id));
      const meta = await fetchCourseForOrder(o.entity_id);
      const cid = String(o.entity_id);
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
      const label = o.type === 'membership' ? 'Membership' : 'Purchase';
      course = {
        id: o.entity_id ? String(o.entity_id) : String(o.id),
        title: label,
        description: '',
        thumbnail: '',
        thumbnail_url: null,
        price: Number(o.amount) || 0,
        category: o.type || '',
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
    if (o.type === 'course' && o.batch_id && course) {
      const batchRow = await fetchBatchById(o.batch_id);
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
      courseId: o.entity_id ? String(o.entity_id) : String(o.id),
      course,
      // Batch this purchase was locked to (nullable — e.g. courses without batches yet).
      batchId: o.batch_id || null,
      enrolledBatch,
      purchaseDate: o.created_at,
      price: Number(o.amount) || 0,
      paymentMethod:
        o.gateway === 'free' || Number(o.amount) === 0
          ? 'Free'
          : payment
            ? 'Razorpay'
            : o.gateway || 'Razorpay',
      transactionId: o.order_id || String(o.id),
      status: purchaseStatus,
      progress: 0,
      completedLessons: [],
      completedAt: undefined,
      lastAccessedAt: undefined,
    });
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

async function listAllOrders({ limit = 100, offset = 0, search = '', sortBy = 'created_at', sortOrder = 'DESC', dateFrom, dateTo, courseId, type }) {
  const where = {};

  if (search) {
    where[Op.or] = [
      { order_id: { [Op.like]: `%${search}%` } },
      { buyer_email: { [Op.like]: `%${search}%` } },
      { buyer_name: { [Op.like]: `%${search}%` } },
      { type: { [Op.like]: `%${search}%` } },
    ];
  }

  if (dateFrom || dateTo) {
    where.created_at = {};
    if (dateFrom) where.created_at[Op.gte] = new Date(dateFrom);
    if (dateTo) where.created_at[Op.lte] = new Date(dateTo);
  }

  if (courseId) {
    where.entity_id = String(courseId);
    where.type = 'course';
  }

  if (type) {
    where.type = type.toLowerCase();
  }

  const { rows, count } = await Order.findAndCountAll({
    where,
    order: [[sortBy, sortOrder]],
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
      'gateway'
    ],
    limit: Math.min(Number(limit) || 100, 500),
    offset: Number(offset) || 0,
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

  let entityNameMap = {};

  // Bulk fetch courses if any
  if (courseIds.length > 0) {
    try {
      const { data: courseRes } = await axios.post(`${config.courseServiceUrl}/internal/courses/by-ids`, {
        ids: courseIds,
      }, {
        headers: { 'X-Internal-API-Key': config.internalApiKey }
      });
      const courses = courseRes.data || courseRes;
      if (Array.isArray(courses)) {
        for (const c of courses) entityNameMap[`course_${c.id}`] = c.title;
      }
    } catch (err) { logger.warn(`Bulk course fetch failed: ${err.message}`); }
  }

  // Bulk fetch plans if any
  if (planIds.length > 0) {
    try {
      // Assuming platform-service has a similar endpoint
      const { data: planRes } = await axios.get(`${config.platformServiceUrl}/internal/platform/plans/list-by-ids`, {
        params: { ids: planIds.join(',') },
        headers: { 'X-Internal-API-Key': config.internalApiKey }
      });
      const plans = planRes.data || planRes;
      if (Array.isArray(plans)) {
        for (const p of plans) entityNameMap[`membership_${p.id}`] = p.name;
      }
    } catch (err) { logger.warn(`Bulk plan fetch failed: ${err.message}`); }
  }

  const enrichedData = orders.map((o) => {
    const payment = paymentMap[o.id];
    const user = userMap[o.user_id];

    return {
      ...o,
      payment_id: payment ? payment.razorpay_payment_id : null,
      // Priority: buyer info on order > linked user info
      buyer_name: o.buyer_name || (user ? user.name : null),
      buyer_email: o.buyer_email || (user ? user.email : null),
      buyer_mobile: o.buyer_mobile || (user ? user.phone : null),
      entity_name: entityNameMap[`${o.type}_${o.entity_id}`] || (o.type === 'membership' ? 'Plan' : 'Course'),
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

/** Revoke course/membership access when an order is refunded or deleted. */
async function revokeAccessForOrder(order) {
  if (!order || !order.user_id) return;
  const userId = order.user_id;
  const oid = order.order_id || order.id;

  if (order.type === 'course') {
    try {
      await axios.post(`${config.courseServiceUrl}/internal/courses/${order.entity_id}/unenroll`, {
        user_id: userId
      }, {
        headers: { 'x-internal-api-key': config.internalApiKey },
        timeout: 10000
      });
    } catch (err) {
      logger.warn(`[orders] failed to revoke course ${order.entity_id} access for user ${userId}: ${err.message}`);
    }
  } else if (order.type === 'membership') {
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
       const { course_ids = [], course_cat_ids = [] } = await fetchPlanLinkedCourses(order.entity_id);
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

async function getOrderByOrderId(orderId) {
  const order = await Order.findOne({ where: { order_id: orderId } });
  if (!order) return null;
  const payment = await Payment.findOne({
    where: { order_id: order.id },
    order: [['id', 'DESC']],
  });
  const p = order.get({ plain: true });
  return { ...p, payment_id: payment ? payment.razorpay_payment_id : null };
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
  try {
    if (p.type === 'course' && p.entity_id) {
      const { data } = await axios.get(`${config.courseServiceUrl}/courses/${p.entity_id}`, {
        timeout: 5000, validateStatus: (s) => s === 200,
      });
      const course = data.data !== undefined ? data.data : data;
      itemName = course?.title || itemName;
      itemCategory = course?.category || '';
    } else if (p.type === 'membership' && p.entity_id) {
      const plan = await fetchPlanDetails(p.entity_id);
      itemName = plan?.name || itemName;
      itemCategory = plan?.duration_days ? `${plan.duration_days} days` : '';
    }
  } catch { /* use defaults */ }

  const isFree = p.gateway === 'free' || Number(p.amount) === 0;
  return {
    orderId: p.order_id,
    type: p.type,
    entityId: p.entity_id,
    itemName,
    itemCategory,
    originalAmount: p.original_amount,
    couponCode: p.coupon_code,
    couponDiscount: p.coupon_discount,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    paidAt: p.created_at,
    paymentId: payment && !isFree ? payment.razorpay_payment_id : null,
    paymentMethod: isFree ? 'Free' : 'Razorpay',
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
  const amount = await resolveAmountForEntity(typeUpper, id);
  const normalizedCode = String(couponCode || '').trim().toLowerCase();
  if (!normalizedCode) throw new AppError('Coupon code is required', 400);

  const coupon = await Coupon.findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('code')), normalizedCode),
  });
  if (!coupon) throw new AppError('Coupon not found', 404);

  const c = coupon.get({ plain: true });
  const result = buildCouponResult(c, amount, typeUpper);
  if (!result.canApply) {
    throw new AppError(`Coupon cannot be applied: ${result.inactiveReason}`, 400);
  }

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
  } = data;

  const typeUpper = normalizeOrderType(type);
  const orderId = generateOrderId();

  let resolvedBatchId = null;
  if (typeUpper === 'COURSE') {
    resolvedBatchId = await fetchPurchaseBatchId(entity_id);
  }

  let originalAmount = 0;
  try {
    originalAmount = await resolveAmountForEntity(typeUpper, entity_id);
  } catch (e) {
    logger.warn(`Could not resolve original amount for ${typeUpper} ${entity_id}: ${e.message}`);
  }

  let couponResult = null;
  if (coupon_code && String(coupon_code).trim()) {
    try {
      couponResult = await validateCouponForOrder(user_id, coupon_code, originalAmount, typeUpper);
    } catch (err) {
      logger.warn(`Manual order coupon validation failed: ${err.message}`);
    }
  }

  const createdOrder = await sequelize.transaction(async (t) => {
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
        status: status,
        affiliate: normalizeReferralForOrder(affiliate),
        gateway: 'manual',
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
      const manualRef = `manual:${orderId}`;
      await Payment.create(
        {
          order_id: locked.id,
          razorpay_payment_id: manualRef,
          razorpay_signature: null,
          amount: locked.amount,
          status: 'captured',
          source: 'manual',
        },
        { transaction: t }
      );
      await emitPurchaseOutbox(locked, t);
      if (couponResult) {
        await recordCouponUsage(couponResult.coupon.id, user_id, orderId, t);
      }
    }

    return locked;
  });

  return createdOrder.get({ plain: true });
}

async function updateOrder(id, data) {
  return await sequelize.transaction(async (t) => {
    const order = await Order.findOne({
      where: { id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });

    if (!order) return null;

    const oldStatus = order.status;
    const newStatus = data.status;

    // Update allowable fields
    const updatableFields = ['buyer_name', 'buyer_email', 'buyer_mobile', 'buyer_gst', 'affiliate', 'amount', 'utm'];
    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        order[field] = data[field];
      }
    }

    if (newStatus && newStatus !== oldStatus) {
      order.status = newStatus;
    }

    await order.save({ transaction: t });

    // If status changed from something else to 'paid', trigger fulfillment
    if (newStatus === 'paid' && oldStatus !== 'paid') {
      const manualRef = `manual:${order.order_id}`;
      await Payment.findOrCreate({
        where: { order_id: order.id, source: 'manual' },
        defaults: {
          order_id: order.id,
          razorpay_payment_id: manualRef,
          razorpay_signature: null,
          amount: order.amount,
          status: 'captured',
          source: 'manual',
        },
        transaction: t,
      });
      await emitPurchaseOutbox(order, t);
    }

    return order.get({ plain: true });
  });
}

async function deleteOrder(id) {
  return await sequelize.transaction(async (t) => {
    const order = await Order.findByPk(id, { transaction: t });
    if (!order) return null;

    // Revoke access before deleting the order record
    await revokeAccessForOrder(order);

    // Delete associated payments
    await Payment.destroy({ where: { order_id: order.id }, transaction: t });

    // Delete the order itself
    await order.destroy({ transaction: t });

    return { id };
  });
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
  createPaymentLinkOrder,
  verifyPaymentLinkOrder,
  listOrders,
  listMyPurchases,
  getInvoice,
  listAllOrders,
  getOrderByOrderId,
  getCouponsForEntity,
  applyCoupon,
  listActiveCoupons,
  listAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  createManualOrder,
  updateOrder,
  deleteOrder,
  refundOrder,
};
