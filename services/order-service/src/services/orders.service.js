const crypto = require('crypto');
const axios = require('axios');
const { sequelize, Order, Payment, OutboxEvent, Coupon } = require('../models');
const { Op } = require('sequelize');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getRazorpayInstance, getRazorpayConfig } = require('./payment.service');
const { AppError } = require('../../../../shared');

function generateOrderId() {
  return 'ORD_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

async function createOrder(userId, { type, entityId, amount, currency = 'INR' }) {
  const razorpay = await getRazorpayInstance();
  if (!razorpay) throw new AppError('Payment not configured', 503);

  const orderId = generateOrderId();
  const amountPaise = Math.round(parseFloat(amount) * 100);
  const lockKey = `order:lock:${userId}:${type}:${entityId}`;
  const redis = await getRedis();
  const locked = await redis.set(lockKey, '1', { NX: true, EX: 30 });
  if (!locked) throw new AppError('Duplicate order in progress', 429);

  try {
    const order = await Order.create({
      order_id: orderId,
      user_id: userId,
      type,
      entity_id: String(entityId),
      amount,
      currency,
      status: 'pending',
    });
    const rpOrder = await razorpay.orders.create({
      amount: amountPaise,
      currency,
      receipt: orderId,
      notes: { orderId, userId: String(userId), type, entityId: String(entityId) },
    });
    await order.update({ razorpay_order_id: rpOrder.id });
    await redis.del(lockKey);
    const config = await getRazorpayConfig();
    return {
      orderId,
      razorpayOrderId: rpOrder.id,
      amount: amountPaise,
      currency,
      key: config?.key_id,
    };
  } catch (err) {
    await redis.del(lockKey).catch(() => { });
    throw err;
  }
}

async function verifyOrder(userId, { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  const config = await getRazorpayConfig();
  if (!config) throw new AppError('Payment not configured', 503);
  const expected = crypto
    .createHmac('sha256', config.key_secret)
    .update(razorpay_order_id + '|' + razorpay_payment_id)
    .digest('hex');
  if (expected !== razorpay_signature) throw new AppError('Invalid signature', 400);

  const t = await sequelize.transaction();
  try {
    const order = await Order.findOne({
      where: { order_id: orderId, user_id: userId },
      transaction: t,
    });
    if (!order) {
      await t.rollback();
      throw new AppError('Order not found', 404);
    }
    if (order.status === 'paid') {
      await t.rollback();
      return { alreadyPaid: true, message: 'Already paid' };
    }
    await order.update({ status: 'paid' }, { transaction: t });
    await Payment.create(
      {
        order_id: order.id,
        razorpay_payment_id,
        razorpay_signature,
        amount: order.amount,
        status: 'captured',
      },
      { transaction: t }
    );
    const payload = { userId: order.user_id, orderId };
    if (order.type === 'course') {
      payload.courseId = order.entity_id;
      await OutboxEvent.create(
        {
          aggregate_type: 'order',
          aggregate_id: orderId,
          event_type: 'COURSE_PURCHASED',
          payload,
        },
        { transaction: t }
      );
    } else if (order.type === 'membership') {
      const now = new Date();
      const expires = new Date(now);
      expires.setFullYear(expires.getFullYear() + 1);
      payload.membershipType = 'annual';
      payload.orderId = orderId;
      payload.startsAt = now.toISOString();
      payload.expiresAt = expires.toISOString();
      await OutboxEvent.create(
        {
          aggregate_type: 'order',
          aggregate_id: orderId,
          event_type: 'MEMBERSHIP_ACTIVATED',
          payload,
        },
        { transaction: t }
      );
    }
    await t.commit();
    return { verified: true };
  } catch (err) {
    await t.rollback();
    if (err.name === 'SequelizeUniqueConstraintError') return { verified: true };
    throw err;
  }
}

async function listOrders(userId) {
  const rows = await Order.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
    attributes: ['order_id', 'type', 'entity_id', 'amount', 'currency', 'status', 'created_at'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * Purchase rows for the learner dashboard — matches cafestudy-fe UserCourse / Payment shapes.
 */
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

  const rows = await Order.findAll({
    where: { user_id: userId },
    order: [['created_at', 'DESC']],
  });
  const out = [];
  for (const row of rows) {
    const o = row.get({ plain: true });
    const payment = await Payment.findOne({
      where: { order_id: o.id },
      order: [['id', 'DESC']],
    });
    let course = null;
    if (o.type === 'course' && o.entity_id) {
      const meta = await fetchCourseForOrder(o.entity_id);
      const cid = String(o.entity_id);
      course = {
        id: cid,
        title: meta?.title || `Course ${cid}`,
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

    out.push({
      id: String(o.id),
      userId: String(o.user_id),
      courseId: o.entity_id ? String(o.entity_id) : String(o.id),
      course,
      purchaseDate: o.created_at,
      price: Number(o.amount) || 0,
      paymentMethod: payment ? 'Razorpay' : o.gateway || 'Razorpay',
      transactionId: o.order_id || String(o.id),
      status: purchaseStatus,
      progress: 0,
      completedLessons: [],
      completedAt: undefined,
      lastAccessedAt: undefined,
    });
  }
  return out;
}

async function listAllOrders(limit = 100, offset = 0) {
  const rows = await Order.findAll({
    order: [['created_at', 'DESC']],
    attributes: ['id', 'order_id', 'user_id', 'type', 'entity_id', 'amount', 'currency', 'status', 'buyer_email', 'created_at'],
    limit: Math.min(Number(limit) || 100, 500),
    offset: Number(offset) || 0,
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getOrderByOrderId(orderId) {
  const order = await Order.findOne({
    where: { order_id: orderId },
  });
  if (!order) return null;
  const payment = await Payment.findOne({
    where: { order_id: order.id },
    order: [['id', 'DESC']],
  });
  const p = order.get({ plain: true });
  return {
    ...p,
    payment_id: payment ? payment.razorpay_payment_id : null,
  };
}

async function getInvoice(userId, orderId) {
  const order = await Order.findOne({
    where: { order_id: orderId, user_id: userId },
  });
  if (!order) return null;
  const payment = await Payment.findOne({
    where: { order_id: order.id },
    order: [['id', 'DESC']],
  });
  const p = order.get({ plain: true });
  return {
    orderId: p.order_id,
    type: p.type,
    entityId: p.entity_id,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    paidAt: p.created_at,
    paymentId: payment ? payment.razorpay_payment_id : null,
  };
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
  if (!config.internalApiKey) {
    throw new AppError('Internal API key not configured', 500);
  }

  const { data } = await axios.get(`${config.courseServiceUrl}/internal/courses/${entityId}`, {
    timeout: 8000,
    headers: {
      'x-internal-api-key': config.internalApiKey,
    },
    validateStatus: (status) => status === 200,
  });
  const payload = parseApiResponse(data);
  const price = parseAmount(payload?.price);
  if (!price) throw new AppError('Course price unavailable', 400);
  return price;
}

async function fetchMembershipAmount(entityId) {
  if (!config.internalApiKey) {
    throw new AppError('Internal API key not configured', 500);
  }

  const { data } = await axios.get(`${config.platformServiceUrl}/internal/platform/plans/${entityId}`, {
    timeout: 8000,
    headers: {
      'x-internal-api-key': config.internalApiKey,
    },
    validateStatus: (status) => status === 200,
  });
  const payload = parseApiResponse(data);
  const price = parseAmount(payload?.price);
  if (!price) throw new AppError('Membership price unavailable', 400);
  return price;
}

async function resolveAmountForEntity(type, entityId) {
  const typeUpper = normalizeOrderType(type);
  if (typeUpper === 'COURSE') {
    return fetchCourseAmount(entityId);
  }
  if (typeUpper === 'MEMBERSHIP') {
    return fetchMembershipAmount(entityId);
  }
  throw new AppError('Invalid type, expected COURSE or MEMBERSHIP', 400);
}

function isCouponTypeValid(coupon, typeUpper) {
  const discountOn = String(coupon.discount_on || '').trim().toLowerCase();
  if (typeUpper === 'COURSE') {
    return discountOn === 'all courses' || discountOn === 'everything';
  }
  if (typeUpper === 'MEMBERSHIP') {
    return discountOn === 'membership only' || discountOn === 'everything';
  }
  return false;
}

function getAllowedDiscountOnValues(typeUpper) {
  if (typeUpper === 'COURSE') {
    return ['all courses', 'everything'];
  }
  if (typeUpper === 'MEMBERSHIP') {
    return ['membership only', 'everything'];
  }
  return [];
}

function calculateDiscount(coupon, amount) {
  const value = parseAmount(coupon.value);
  const maxDiscount = parseAmount(coupon.max_discount);
  let discount = 0;
  if (String(coupon.type || '').trim().toLowerCase() === 'percentage') {
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
  let canApply = published && validType && dateValid && meetsMinOrder;
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

// function buildActiveCouponResult(coupon) {
//   return {
//     id: coupon.id,
//     code: coupon.code,
//     description: coupon.description,
//     type: coupon.type,
//     value: parseAmount(coupon.value),
//     min_order: parseAmount(coupon.min_order),
//     max_discount: parseAmount(coupon.max_discount),
//     discount_on: coupon.discount_on,
//     start_date: coupon.start_date,
//     expire_date: coupon.expire_date,
//     status: coupon.status,
//     created_at: coupon.created_at,
//     isActive: true,
//   };
// }

async function listActiveCoupons() {
  const now = new Date();
  const coupons = await Coupon.findAll({
    where: {
      status: 'publish',
      [Op.and]: [
        {
          [Op.or]: [
            { start_date: null },
            { start_date: { [Op.lte]: now } },
          ],
        },
        {
          [Op.or]: [
            { expire_date: null },
            { expire_date: { [Op.gte]: now } },
          ],
        },
      ],
    },
    order: [['created_at', 'DESC']],
  });
  return coupons.map((coupon) => coupon.get({ plain: true }));
}

async function getCouponsForEntity(userId, type, entityId) {
  const typeUpper = normalizeOrderType(type);
  if (!typeUpper && !entityId) {
    return {
      type: null,
      entityId: null,
      amount: null,
      coupons: await listActiveCoupons(),
    };
  }

  const amount = await resolveAmountForEntity(typeUpper, entityId);
  const allowedDiscountOnValues = getAllowedDiscountOnValues(typeUpper);
  const coupons = await Coupon.findAll({ order: [['created_at', 'DESC']] });
  const results = coupons
    .filter((coupon) =>
      allowedDiscountOnValues.includes(String(coupon.discount_on || '').trim().toLowerCase())
    )
    .map((coupon) => buildCouponResult(coupon.get({ plain: true }), amount, typeUpper))
    .sort((a, b) => {
      if (a.canApply !== b.canApply) return a.canApply ? -1 : 1;
      if (b.discountAmount !== a.discountAmount) return b.discountAmount - a.discountAmount;
      return a.min_order - b.min_order;
    });

  return {
    type: typeUpper,
    entityId,
    amount,
    coupons: results,
  };
}

async function applyCoupon(userId, { couponCode, type, id }) {
  const typeUpper = normalizeOrderType(type);
  const amount = await resolveAmountForEntity(typeUpper, id);
  const normalizedCode = String(couponCode || '').trim().toLowerCase();
  if (!normalizedCode) throw new AppError('Coupon code is required', 400);

  const coupon = await Coupon.findOne({
    where: sequelize.where(
      sequelize.fn('lower', sequelize.col('code')),
      normalizedCode,
    ),
  });
  if (!coupon) throw new AppError('Coupon not found', 404);

  const result = buildCouponResult(coupon.get({ plain: true }), amount, typeUpper);
  if (!result.canApply) {
    throw new AppError(`Coupon cannot be applied: ${result.inactiveReason}`, 400);
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

module.exports = {
  createOrder,
  verifyOrder,
  listOrders,
  listMyPurchases,
  getInvoice,
  listAllOrders,
  getOrderByOrderId,
  getCouponsForEntity,
  applyCoupon,
};
