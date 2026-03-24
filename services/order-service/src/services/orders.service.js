const crypto = require('crypto');
const axios = require('axios');
const { sequelize, Order, Payment, OutboxEvent } = require('../models');
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

module.exports = {
  createOrder,
  verifyOrder,
  listOrders,
  listMyPurchases,
  getInvoice,
  listAllOrders,
  getOrderByOrderId,
};