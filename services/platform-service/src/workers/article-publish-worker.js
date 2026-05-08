/**
 * Article Publish Worker
 * ══════════════════════
 * Standalone BullMQ worker — run as a SEPARATE process from the API server.
 *
 * Start commands:
 *   npm run worker:article-publish          (inside services/platform-service)
 *   npm run start:platform-worker           (from repo root — production)
 *   npm run dev:platform-worker             (from repo root — development)
 *
 * This is the PRIMARY scheduler. When running, delayed jobs fire at their
 * exact scheduled time with near-millisecond precision.
 * The in-process poller (article-poll.service.js) in the API server acts as
 * a fallback in case this worker is not deployed.
 *
 * All publishes go through atomicPublishArticle() (conditional SQL UPDATE
 * WHERE status='scheduled') — safe to run alongside the poller or other
 * worker instances without double-publishing.
 */

const { Worker } = require('bullmq');
const config = require('../config');
const { getRedisConnection, closeAllRedisConnections } = require('../queues/redis.connection');
const { queueName } = require('../queues/articlePublish.queue');
const { JOB_NAME } = require('../services/article-scheduling.service');
const { processArticlePublishJob } = require('./article-publish.processor');
const { connect } = require('../models');
const { logger } = require('../../../../shared');

const CONCURRENCY = config.articlePublishQueue.workerConcurrency;

const worker = new Worker(
  queueName,
  async (job) => {
    if (job.name && job.name !== JOB_NAME) {
      logger.warn('[article-publish-worker] unexpected job name — skipping', {
        received: job.name,
        expected: JOB_NAME,
        jobId: job.id,
      });
      return;
    }
    await processArticlePublishJob(job);
  },
  {
    connection: getRedisConnection('worker'),
    concurrency: CONCURRENCY,
  },
);

// ─── Worker lifecycle events ─────────────────────────────────────────────────

worker.on('ready', () => {
  logger.info('[article-publish-worker] READY', {
    queue: queueName,
    concurrency: CONCURRENCY,
    redis: config.redis.url.replace(/:[^:@]+@/, ':****@'),
  });
  console.log(
    `[article-publish-worker] listening on "${queueName}" (concurrency=${CONCURRENCY}) — articles will publish on time.`,
  );
});

worker.on('error', (err) => {
  logger.error('[article-publish-worker] worker error', { message: err.message });
});

worker.on('stalled', (jobId) => {
  logger.warn('[article-publish-worker] job stalled', { jobId, queue: queueName });
});

worker.on('completed', (job) => {
  logger.info('[article-publish-worker] job completed', {
    jobId: job.id,
    articleId: job.data?.articleId,
  });
});

worker.on('failed', (job, err) => {
  logger.error('[article-publish-worker] job failed', {
    jobId: job?.id,
    articleId: job?.data?.articleId,
    attempts: job?.attemptsMade,
    message: err?.message,
  });
});

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main() {
  await connect();
  logger.info('[article-publish-worker] started', {
    queue: queueName,
    concurrency: CONCURRENCY,
    redis: config.redis.url.replace(/:[^:@]+@/, ':****@'),
  });
}

main().catch((err) => {
  logger.error('[article-publish-worker] fatal startup error', { message: err.message });
  process.exit(1);
});

// ─── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`[article-publish-worker] received ${signal} — shutting down gracefully`);
  try {
    await worker.close();
    logger.info('[article-publish-worker] worker closed');
  } catch (err) {
    logger.error('[article-publish-worker] error closing worker', { message: err.message });
  }
  await closeAllRedisConnections();
  process.exit(0);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
