const { Op } = require('sequelize');
const axios = require('axios');
const { OutboxEvent } = require('../models');
const config = require('../config');
const { logger } = require('../../../../shared');

const MAX_RETRIES = 5;

function getBackoffMs(retryCount) {
  // Exponential backoff: 2^retry seconds, capped at 5 min
  return Math.min(Math.pow(2, retryCount) * 1000, 5 * 60 * 1000);
}

async function processEvent(record) {
  const { id, event_type, payload, retry_count } = record;
  const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
  try {
    if (event_type === 'COURSE_PURCHASED') {
      const expiresAt = data.validity === 'lifetime'
        ? null
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      await Promise.all([
        axios.post(
          `${config.authServiceUrl}/access/grant-course`,
          {
            userId: data.userId,
            courseId: data.courseId,
            orderId: data.orderId,
            expiresAt,
          },
          { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
        ),
        axios.post(
          `${config.courseServiceUrl}/internal/courses/${data.courseId}/auto-enroll`,
          {
            user_id: data.userId,
            batch_id: data.batchId || null,
          },
          { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
        )
      ]);
    } else if (event_type === 'MEMBERSHIP_ACTIVATED') {
      await axios.post(
        `${config.authServiceUrl}/access/grant-membership`,
        {
          userId: data.userId,
          membershipType: data.membershipType,
          orderId: data.orderId,
          startsAt: data.startsAt,
          expiresAt: data.expiresAt,
        },
        { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
      );
    } else if (event_type === 'AFFILIATE_COMMISSION') {
      await axios.post(
        `${config.courseServiceUrl}/internal/affiliate/record-commission`,
        {
          userId: data.userId,
          orderId: data.orderId,
          type: data.type,
          entityId: data.entityId,
          amount: data.amount,
          referralCode: data.referralCode,
        },
        { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
      ).catch(err => {
        logger.warn(`Failed to record affiliate commission for order ${data.orderId}: ${err.message}`);
        throw err;
      });
    } else if (event_type === 'ORDER_REFUNDED') {
      if (data.type === 'course') {
        await Promise.all([
          axios.post(
            `${config.authServiceUrl}/access/revoke-course`,
            { userId: data.userId, courseId: data.entityId, orderId: data.orderId },
            { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
          ),
          axios.post(
            `${config.courseServiceUrl}/internal/courses/${data.entityId}/unenroll`,
            { user_id: data.userId },
            { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
          )
        ]);
      } else if (data.type === 'membership') {
        await axios.post(
          `${config.authServiceUrl}/access/revoke-membership`,
          { userId: data.userId, orderId: data.orderId },
          { headers: { 'X-Internal-API-Key': config.internalApiKey }, timeout: 10000 }
        );
      }
    }
    await OutboxEvent.update(
      { status: 'processed', processed_at: new Date() },
      { where: { id } }
    );
    logger.info(`Outbox event ${id} processed`);
  } catch (err) {
    const nextRetry = (retry_count || 0) + 1;
    if (nextRetry >= MAX_RETRIES) {
      await OutboxEvent.update({ status: 'failed', retry_count: nextRetry }, { where: { id } });
      logger.error(`Outbox event ${id} permanently failed after ${nextRetry} attempts: ${err.message}`);
    } else {
      const nextRetryAt = new Date(Date.now() + getBackoffMs(nextRetry));
      await OutboxEvent.update(
        { status: 'retrying', retry_count: nextRetry, next_retry_at: nextRetryAt },
        { where: { id } }
      );
      logger.warn(`Outbox event ${id} failed (attempt ${nextRetry}/${MAX_RETRIES}), retrying at ${nextRetryAt.toISOString()}`);
    }
  }
}

async function poll() {
  const rows = await OutboxEvent.findAll({
    where: {
      [Op.or]: [
        { status: 'pending' },
        {
          status: 'retrying',
          next_retry_at: { [Op.lte]: new Date() },
        },
      ],
    },
    order: [['id', 'ASC']],
    limit: 10,
  });
  for (const row of rows) {
    await processEvent(row.get({ plain: true }));
  }
}

function startOutboxWorker() {
  const pollMs = config.outbox.pollMs;
  setInterval(poll, pollMs);
  poll();
  logger.info('Outbox worker started');
}

module.exports = { startOutboxWorker, processEvent };
