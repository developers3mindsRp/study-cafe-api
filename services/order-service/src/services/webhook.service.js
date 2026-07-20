const crypto = require('crypto');
const { sequelize, Order, Payment, WebhookEvent } = require('../models');
const config = require('../config');
const { completePayment, emitPaymentEmailOutbox, captureRazorpayPayment } = require('./orders.service');
const { logger } = require('../../../../shared');

const { getRazorpayConfig } = require('./payment.service');

async function verifySignature(rawBody, signature) {
  let secret = config.razorpay.webhookSecret;
  if (!secret) {
    const dynamicConfig = await getRazorpayConfig();
    secret = dynamicConfig?.webhook_secret;
  }
  if (!secret) {
    logger.error('[WEBHOOK] RAZORPAY_WEBHOOK_SECRET is not configured');
    return false;
  }
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  try {
    // Use timing-safe comparison to prevent timing attacks
    // Both buffers must be same byte length for timingSafeEqual
    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== receivedBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
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

  logger.info(`[WEBHOOK] payment.authorized — rp_order: ${payment.order_id}, rp_payment: ${payment.id}, amount: ${payment.amount}`);

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) {
    logger.warn(`[WEBHOOK] payment.authorized — order not found for rp_order: ${payment.order_id}`);
    return 'order_not_found';
  }
  if (order.status !== 'pending') {
    logger.info(`[WEBHOOK] payment.authorized — order ${order.order_id} already ${order.status}, skipping`);
    return 'skipped';
  }

  const existingPay = await Payment.findOne({ where: { razorpay_payment_id: payment.id } });
  if (!existingPay) {
    await Payment.create({
      order_id: order.id,
      razorpay_payment_id: payment.id,
      amount: payment.amount / 100,
      status: 'authorized',
      source: 'webhook',
    });
  }
  logger.info(`[WEBHOOK] payment.authorized — recorded for order ${order.order_id}`);

  // Capture immediately instead of waiting for dashboard auto-capture. Covers
  // payments where the customer never returned to the checkout verify page —
  // without this they stay authorized and Razorpay auto-refunds after ~1 day.
  // Idempotent; the resulting payment.captured webhook then completes the order.
  await captureRazorpayPayment(payment.id, payment.amount / 100, payment.currency);
  logger.info(`[WEBHOOK] payment.authorized — capture requested for order ${order.order_id}`);

  return 'processed';
}

async function handlePaymentCaptured(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  logger.info(`[WEBHOOK] payment.captured — rp_order: ${payment.order_id}, rp_payment: ${payment.id}, amount: ${payment.amount}`);

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) {
    logger.warn(`[WEBHOOK] payment.captured — order not found for rp_order: ${payment.order_id}`);
    return 'order_not_found';
  }
  if (order.status === 'paid') {
    logger.info(`[WEBHOOK] payment.captured — order ${order.order_id} already paid, skipping`);
    return 'skipped';
  }

  const result = await completePayment(order, payment.id, { source: 'webhook' });
  logger.info(`[WEBHOOK] payment.captured — completePayment result for ${order.order_id}: ${JSON.stringify(result)}`);
  return result.alreadyPaid ? 'skipped' : 'processed';
}

async function handlePaymentFailed(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  logger.info(`[WEBHOOK] payment.failed — rp_order: ${payment.order_id}, rp_payment: ${payment.id}, reason: ${payment.error_description || 'unknown'}`);

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) {
    logger.warn(`[WEBHOOK] payment.failed — order not found for rp_order: ${payment.order_id}`);
    return 'order_not_found';
  }
  if (order.status !== 'pending') {
    logger.info(`[WEBHOOK] payment.failed — order ${order.order_id} is ${order.status}, skipping`);
    return 'skipped';
  }

  await sequelize.transaction(async (t) => {
    const locked = await Order.findOne({
      where: { id: order.id },
      lock: t.LOCK.UPDATE,
      transaction: t,
    });
    if (!locked) return;
    await locked.update({ status: 'failed' }, { transaction: t });
    await Payment.create(
      {
        order_id: locked.id,
        razorpay_payment_id: payment.id,
        amount: payment.amount / 100,
        status: 'failed',
        source: 'webhook',
      },
      { transaction: t }
    );
    await emitPaymentEmailOutbox(locked, payment.id, 'failed', t, {
      failReason: payment.error_description || 'Payment could not be processed',
    });
  });
  logger.info(`[WEBHOOK] payment.failed — marked order ${order.order_id} as failed`);
  return 'processed';
}

async function handleOrderPaid(body) {
  const orderEntity = body?.payload?.order?.entity;
  if (!orderEntity) return 'no_order_entity';

  logger.info(`[WEBHOOK] order.paid — rp_order: ${orderEntity.id}, amount: ${orderEntity.amount}`);

  const order = await findOrderByRazorpayId(orderEntity.id);
  if (!order) {
    logger.warn(`[WEBHOOK] order.paid — order not found for rp_order: ${orderEntity.id}`);
    return 'order_not_found';
  }
  if (order.status === 'paid') {
    logger.info(`[WEBHOOK] order.paid — order ${order.order_id} already paid, skipping`);
    return 'skipped';
  }

  const payments = orderEntity.payments?.items;
  const rpPaymentId = payments?.[0]?.id || `order_paid_${orderEntity.id}`;
  const result = await completePayment(order, rpPaymentId, { source: 'webhook' });
  logger.info(`[WEBHOOK] order.paid — completePayment result for ${order.order_id}: ${JSON.stringify(result)}`);
  return result.alreadyPaid ? 'skipped' : 'processed';
}

async function handleRefundCreated(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';
  if (order.status !== 'paid') return 'skipped';

  await order.update({ status: 'refund_initiated' });
  logger.info(`[WEBHOOK] refund.created — order ${order.order_id} → refund_initiated`);
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
  logger.info(`[WEBHOOK] refund.processed — order ${order.order_id} → refunded`);
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
  logger.info(`[WEBHOOK] refund.failed — order ${order?.order_id} reverted to paid`);
  return 'processed';
}

async function handleDisputeCreated(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';

  await order.update({ status: 'disputed' });
  logger.info(`[WEBHOOK] dispute.created — order ${order.order_id} → disputed`);
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
  logger.info(`[WEBHOOK] dispute.won — order ${order.order_id} → paid`);
  return 'processed';
}

async function handleDisputeLost(body) {
  const payment = extractPaymentEntity(body);
  if (!payment) return 'no_payment_entity';

  const order = await findOrderByRazorpayId(payment.order_id);
  if (!order) return 'order_not_found';

  await order.update({ status: 'refunded' });
  logger.info(`[WEBHOOK] dispute.lost — order ${order.order_id} → refunded`);
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
  const eventType = parsedBody?.event || 'unknown';

  // Build a stable idempotency key. Razorpay v1 webhooks don't always include a
  // top-level `id`, so we derive one from the entity IDs + event type.
  // We deliberately avoid Date.now() to prevent non-deterministic keys.
  const paymentEntity = extractPaymentEntity(parsedBody);
  const rpPaymentId = paymentEntity?.id;
  const rpOrderId = paymentEntity?.order_id || parsedBody?.payload?.order?.entity?.id;
  const eventId =
    parsedBody?.id ||
    parsedBody?.event_id ||
    (rpPaymentId ? `${eventType}:${rpPaymentId}` : null) ||
    (rpOrderId   ? `${eventType}:${rpOrderId}`   : null) ||
    null; // Null means we can't deduplicate — we'll log and skip rather than risk replay

  if (!eventId) {
    logger.warn(`[WEBHOOK] Could not derive idempotency key for event: ${eventType} — skipping`);
    return { statusCode: 200, body: { status: 'skipped_no_id' } };
  }

  logger.info(`[WEBHOOK] Incoming event: ${eventType} | id: ${eventId}`);

  if (!await verifySignature(rawBody, signature)) {
    logger.warn(`[WEBHOOK] ✗ Signature FAILED for event: ${eventType}`);
    return { statusCode: 400, body: { status: 'invalid_signature' } };
  }

  logger.info(`[WEBHOOK] ✓ Signature verified for event: ${eventType}`);

  if (!eventType || eventType === 'unknown') {
    logger.warn(`[WEBHOOK] Missing event type`);
    return { statusCode: 200, body: { status: 'missing_event_type' } };
  }

  const existing = await WebhookEvent.findOne({ where: { event_id: eventId } });
  if (existing) {
    logger.info(`[WEBHOOK] Already processed ${eventId}, returning 200`);
    return { statusCode: 200, body: { status: 'already_processed' } };
  }

  const webhookRecord = await WebhookEvent.create({
    event_id: eventId,
    event_type: eventType,
    razorpay_order_id: rpOrderId || null,
    razorpay_payment_id: rpPaymentId || null,
    payload: parsedBody,
    status: 'received',
  });

  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    await webhookRecord.update({ status: 'skipped', processed_at: new Date() });
    logger.info(`[WEBHOOK] Unhandled event type "${eventType}", skipped`);
    return { statusCode: 200, body: { status: 'ok' } };
  }

  try {
    const result = await handler(parsedBody);
    const finalStatus = result === 'skipped' ? 'skipped' : 'processed';
    await webhookRecord.update({ status: finalStatus, processed_at: new Date() });
    logger.info(`[WEBHOOK] ✓ ${eventType} → ${result} (record id: ${webhookRecord.id})`);
  } catch (err) {
    await webhookRecord.update({
      status: 'error',
      error_message: err.message,
      processed_at: new Date(),
    });
    logger.error(`[WEBHOOK] ✗ ${eventType} error — ${err.message}`);
    logger.error(`[WEBHOOK] Stack: ${err.stack}`);
  }

  return { statusCode: 200, body: { status: 'ok' } };
}

module.exports = { processWebhook, verifySignature };
