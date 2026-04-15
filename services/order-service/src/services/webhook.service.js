const crypto = require('crypto');
const { Order, Payment, WebhookEvent } = require('../models');
const config = require('../config');
const { completePayment } = require('./orders.service');
const { logger } = require('../../../../shared');

function verifySignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret) return false;
  const expected = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function extractPaymentEntity(body) {
  return body?.payload?.payment?.entity || null;
}

function extractRefundEntity(body) {
  return body?.payload?.refund?.entity || null;
}

async function findOrderByRazorpayId(razorpayOrderId) {
  if (!razorpayOrderId) return null;
  return Order.findOne({ where: { razorpay_order_id: razorpayOrderId } });
}

async function handlePaymentAuthorized(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status !== 'pending') return 'skipped';

  await Payment.create({
    order_id: order.id,
    razorpay_payment_id: payment.id,
    amount: payment.amount / 100,
    status: 'authorized',
    source: 'webhook',
  });
  return 'processed';
}

async function handlePaymentCaptured(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status === 'paid') return 'skipped';

  const result = await completePayment(order, payment.id, { source: 'webhook' });
  return result.alreadyPaid ? 'skipped' : 'processed';
}

async function handlePaymentFailed(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status !== 'pending') return 'skipped';

  await order.update({ status: 'failed' });
  await Payment.create({
    order_id: order.id,
    razorpay_payment_id: payment.id,
    amount: payment.amount / 100,
    status: 'failed',
    source: 'webhook',
  });
  return 'processed';
}

async function handleOrderPaid(body) {
  const orderEntity = body?.payload?.order?.entity;
  if (!orderEntity) return 'no_order_entity';

  const order = await findOrderByRazorpayId(orderEntity.id);
  if (!order) return 'order_not_found';
  if (order.status === 'paid') return 'skipped';

  const payments = orderEntity.payments?.items;
  const rpPaymentId = payments?.[0]?.id || `order_paid_${orderEntity.id}`;
  const result = await completePayment(order, rpPaymentId, { source: 'webhook' });
  return result.alreadyPaid ? 'skipped' : 'processed';
}

async function handleRefundCreated(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status !== 'paid') return 'skipped';

  await order.update({ status: 'refund_initiated' });
  return 'processed';
}

async function handleRefundProcessed(body) {
  const refund = extractRefundEntity(body);
  const payment = extractPaymentEntity(body);
  const rpOrderId = payment?.order_id || refund?.notes?.razorpay_order_id;
  if (!rpOrderId) return 'no_order_id';

  const order = await findOrderByRazorpayId(rpOrderId);
  if (!order) return 'order_not_found';
  if (order.status !== 'paid' && order.status !== 'refund_initiated') return 'skipped';

  await order.update({ status: 'refunded' });
  if (payment?.id) {
    await Payment.update(
      { status: 'refunded' },
      { where: { order_id: order.id, razorpay_payment_id: payment.id } }
    );
  }
  return 'processed';
}

async function handleRefundFailed(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status === 'refund_initiated') {
    await order.update({ status: 'paid' });
  }
  return 'processed';
}

async function handleDisputeCreated(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';

  await order.update({ status: 'disputed' });
  return 'processed';
}

async function handleDisputeWon(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status === 'disputed') {
    await order.update({ status: 'paid' });
  }
  return 'processed';
}

async function handleDisputeLost(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';

  await order.update({ status: 'refunded' });
  return 'processed';
}

const EVENT_HANDLERS = {
  'payment.authorized': handlePaymentAuthorized,
  'payment.captured': handlePaymentCaptured,
  'payment.failed': handlePaymentFailed,
  'order.paid': handleOrderPaid,
  'refund.created': handleRefundCreated,
  'refund.processed': handleRefundProcessed,
  'refund.failed': handleRefundFailed,
  'payment.dispute.created': handleDisputeCreated,
  'payment.dispute.won': handleDisputeWon,
  'payment.dispute.lost': handleDisputeLost,
};

async function processWebhook(rawBody, signature, parsedBody) {
  if (!verifySignature(rawBody, signature)) {
    return { statusCode: 400, body: { status: 'invalid_signature' } };
  }

  const eventId = parsedBody.id || parsedBody.event_id;
  const eventType = parsedBody.event;
  if (!eventId || !eventType) {
    return { statusCode: 400, body: { status: 'missing_event_data' } };
  }

  const existing = await WebhookEvent.findOne({ where: { event_id: eventId } });
  if (existing) {
    return { statusCode: 200, body: { status: 'already_processed' } };
  }

  const paymentEntity = extractPaymentEntity(parsedBody);
  const webhookRecord = await WebhookEvent.create({
    event_id: eventId,
    event_type: eventType,
    razorpay_order_id: paymentEntity?.order_id || null,
    razorpay_payment_id: paymentEntity?.id || null,
    payload: parsedBody,
    status: 'received',
  });

  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    await webhookRecord.update({ status: 'skipped', processed_at: new Date() });
    logger.info(`Webhook ${eventId}: unhandled event type "${eventType}", skipped`);
    return { statusCode: 200, body: { status: 'ok' } };
  }

  try {
    const result = await handler(parsedBody);
    const finalStatus = result === 'skipped' ? 'skipped' : 'processed';
    await webhookRecord.update({ status: finalStatus, processed_at: new Date() });
    logger.info(`Webhook ${eventId}: ${eventType} → ${result}`);
  } catch (err) {
    await webhookRecord.update({
      status: 'error',
      error_message: err.message,
      processed_at: new Date(),
    });
    logger.error(`Webhook ${eventId}: ${eventType} error — ${err.message}`);
  }

  return { statusCode: 200, body: { status: 'ok' } };
}

module.exports = { processWebhook, verifySignature };
