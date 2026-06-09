/**
 * Article Scheduling Service
 * ══════════════════════════
 *
 * Scheduling layers (highest priority first):
 *
 * 1. BullMQ worker (article-publish-worker.js — separate process)
 *    PRIMARY scheduler. Jobs are stored in Redis as delayed jobs and fire
 *    with near-millisecond precision. Requires REDIS_URL and the worker
 *    process to be running.
 *
 * 2. In-process poller (article-poll.service.js — runs inside API server)
 *    FALLBACK safety net. Scans MySQL every N seconds for overdue scheduled
 *    articles and publishes them. Works even if Redis/BullMQ is down or the
 *    worker is not deployed. Enabled via ENABLE_ARTICLE_POLLING=true (default).
 *
 * 3. Reconcile on startup (reconcileScheduledArticleJobs)
 *    RECOVERY mechanism. Runs once when the API boots. Publishes any
 *    articles that became overdue while the server was offline, and
 *    re-enqueues future-scheduled articles into Redis in case the queue was
 *    flushed or the delayed jobs disappeared.
 *
 * Race condition safety
 * ─────────────────────
 * All three layers ultimately call atomicPublishArticle() which performs a
 * single conditional SQL UPDATE:
 *
 *   UPDATE articles SET status='publish', ...
 *   WHERE  id = :id AND status = 'scheduled'
 *
 * If the UPDATE affects 0 rows (already published by another layer/instance)
 * the function returns false and the caller does nothing further.  This
 * prevents double-publishing across worker, poller, reconcile, and multiple
 * API replicas running concurrently.
 *
 * QueueScheduler note
 * ───────────────────
 * BullMQ v2+ has a built-in mini-scheduler and QueueScheduler was removed.
 * We are on BullMQ v5 — no QueueScheduler setup is required.
 */

const { QueryTypes } = require('sequelize');
const { logger }     = require('../../../../shared');
const { activeRowWhere } = require('../../../../shared');
const { sequelize, Article } = require('../models');
const { getArticlePublishQueue, publishJobId, queueName } = require('../queues/articlePublish.queue');

const JOB_NAME = 'publish-article';

// ─── Atomic publish ─────────────────────────────────────────────────────────

/**
 * Publish a scheduled article using a single atomic conditional UPDATE.
 *
 * Returns true  → this call performed the publish (affected rows = 1).
 * Returns false → article was already published by another process/layer (no-op).
 *
 * @param {number} articleId
 * @param {Date}   publishedAt  - timestamp to record as published_at
 * @returns {Promise<boolean>}
 */
async function atomicPublishArticle(articleId, publishedAt) {
  const [, meta] = await sequelize.query(
    `UPDATE articles
        SET status = 'publish',
            published_at = :publishedAt,
            scheduled_publish_at = NULL
      WHERE id = :id
        AND status = 'scheduled'
        AND deleted_at IS NULL`,
    {
      replacements: { id: articleId, publishedAt },
      type: QueryTypes.UPDATE,
    },
  );

  // Sequelize returns [results, affectedRows] for UPDATE statements
  const affected = typeof meta === 'number' ? meta : (meta?.affectedRows ?? 0);
  return affected > 0;
}

// ─── BullMQ job management ───────────────────────────────────────────────────

/**
 * Remove any existing BullMQ delayed job for an article.
 * Safe to call even when no job exists or Redis is down.
 */
async function removeScheduledPublishJob(articleId) {
  const q   = getArticlePublishQueue();
  const id  = publishJobId(articleId);
  try {
    const job = await q.getJob(id);
    if (job) {
      await job.remove();
      logger.info('[article-schedule] removed queued job', { articleId: Number(articleId), jobId: id });
    }
  } catch (err) {
    logger.error('[article-schedule] remove job failed', {
      articleId: Number(articleId),
      jobId: id,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Enqueue a new delayed BullMQ job. Idempotent — removes any prior job first.
 * Returns null if runAt is not in the future (poller/reconcile will handle it).
 *
 * @param {number|string} articleId
 * @param {Date}          runAt
 */
async function enqueueScheduledPublish(articleId, runAt) {
  const delayMs = runAt.getTime() - Date.now();
  if (delayMs <= 0) {
    logger.warn('[article-schedule] enqueue skipped — time is not in the future', {
      articleId: Number(articleId),
      runAt: runAt.toISOString(),
    });
    return null;
  }

  const q  = getArticlePublishQueue();
  const id = publishJobId(articleId);

  // Remove stale job first (idempotent reschedule)
  await removeScheduledPublishJob(articleId).catch(() => {});

  const job = await q.add(
    JOB_NAME,
    { articleId: Number(articleId) },
    { jobId: id, delay: delayMs },
  );

  logger.info('[article-schedule] enqueued delayed publish', {
    queueName,
    articleId: Number(articleId),
    jobId: job.id,
    runAt: runAt.toISOString(),
    delayMs,
  });

  return job;
}

/**
 * Sync the Redis queue with the DB row after a create/update.
 *
 * - status='scheduled' + future time  → enqueue BullMQ delayed job
 * - status='scheduled' + overdue time → atomically publish immediately
 * - any other status                  → remove any existing job
 *
 * @param {{ id: number, status: string, scheduled_publish_at?: Date|string|null }} row
 */
async function syncArticlePublishJob(row) {
  if (!row?.id) return;

  const articleId = row.id;
  const status    = String(row.status || '').toLowerCase();

  if (status === 'scheduled' && row.scheduled_publish_at) {
    const runAt   = new Date(row.scheduled_publish_at);
    const delayMs = runAt.getTime() - Date.now();

    if (delayMs <= 0) {
      // Article became overdue before we could enqueue — publish now
      logger.info('[article-schedule] overdue at sync — publishing immediately', { articleId });
      const published = await atomicPublishArticle(articleId, runAt <= new Date() ? runAt : new Date());
      if (published) {
        logger.info('[article-schedule] published overdue article', { articleId });
      }
      await removeScheduledPublishJob(articleId).catch(() => {});
      return;
    }

    await enqueueScheduledPublish(articleId, runAt);
    return;
  }

  await removeScheduledPublishJob(articleId).catch(() => {});
}

// ─── Recovery: runs once on API startup ─────────────────────────────────────

/**
 * Reconcile MySQL scheduled articles with Redis.
 *
 * Purpose: RECOVERY. If the API was down, Redis was flushed, or the worker
 * was offline, this catches all articles that became due and publishes them,
 * then re-enqueues still-future articles so the worker can fire on time.
 *
 * Called once inside server.js during startup — before accepting HTTP requests.
 */
async function reconcileScheduledArticleJobs() {
  const rows = await Article.findAll({
    where: { status: 'scheduled', ...activeRowWhere() },
    attributes: ['id', 'status', 'scheduled_publish_at'],
  });

  logger.info('[article-schedule] reconcile started', { count: rows.length });

  for (const r of rows) {
    const plain = r.get({ plain: true });
    try {
      await syncArticlePublishJob(plain);
    } catch (err) {
      logger.error('[article-schedule] reconcile row failed', {
        articleId: plain.id,
        message: err.message,
      });
    }
  }

  logger.info('[article-schedule] reconcile done');

  // Log queue state for visibility
  try {
    const counts = await getArticlePublishQueue().getJobCounts('delayed', 'waiting', 'active', 'failed');
    logger.info('[article-schedule] queue counts after reconcile', { queueName, ...counts });
    if (Number(counts.delayed) > 0) {
      logger.warn(
        '[article-schedule] delayed jobs will not fire until the BullMQ worker is running',
        { delayed: counts.delayed, queueName },
      );
    }
  } catch (e) {
    logger.warn('[article-schedule] could not read queue counts (Redis down?)', { message: e.message });
  }
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

/**
 * Close the BullMQ queue and all Redis connections (called during shutdown).
 */
async function shutdownQueues() {
  const { closeQueue } = require('../queues/articlePublish.queue');
  await closeQueue().catch((err) =>
    logger.error('[article-schedule] shutdown error', { message: err.message }),
  );
}

module.exports = {
  JOB_NAME,
  atomicPublishArticle,
  removeScheduledPublishJob,
  enqueueScheduledPublish,
  syncArticlePublishJob,
  reconcileScheduledArticleJobs,
  shutdownQueues,
};
