/**
 * BullMQ queue for article publishing jobs.
 *
 * Architecture note
 * ─────────────────
 * This module provides the Queue instance used by the API to *enqueue* jobs.
 * The Worker (article-publish-worker.js) runs as a separate process and
 * *consumes* from this same queue.  Both must share the same REDIS_URL and
 * ARTICLE_PUBLISH_QUEUE_NAME values.
 *
 * QueueScheduler: NOT needed — BullMQ v2+ has a built-in scheduler and the
 * `QueueScheduler` class was removed in BullMQ v2.  We are on v5, so no
 * scheduler setup is required.
 */
const { Queue } = require('bullmq');
const config = require('../config');
const { getRedisConnection, closeAllRedisConnections } = require('./redis.connection');
const { logger } = require('../../../../shared');

const { name: queueName } = config.articlePublishQueue;

/** @type {Queue | null} */
let _queue = null;

/**
 * Return the singleton Queue instance (lazily created).
 * @returns {Queue}
 */
function getArticlePublishQueue() {
  if (!_queue) {
    _queue = new Queue(queueName, {
      connection: getRedisConnection('queue'),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 4_000 },
        removeOnComplete: { age: 24 * 3600, count: 5_000 },
        removeOnFail:     { age: 7 * 24 * 3600 },
      },
    });
  }
  return _queue;
}

/**
 * Deterministic job ID — guarantees reschedule = remove + re-add with no duplicates.
 * @param {number|string} articleId
 * @returns {string}
 */
function publishJobId(articleId) {
  return `article-publish:${articleId}`;
}

/**
 * Close the Queue connection cleanly (called during graceful shutdown).
 * Also closes all underlying Redis connections.
 * @returns {Promise<void>}
 */
async function closeQueue() {
  if (_queue) {
    await _queue.close().catch((err) =>
      logger.error('[article-queue] queue.close() error', { error: err.message }),
    );
    _queue = null;
  }
  await closeAllRedisConnections();
}

module.exports = {
  getArticlePublishQueue,
  publishJobId,
  closeQueue,
  queueName,
};
