/**
 * Platform Service — API server entry point.
 *
 * Startup sequence
 * ────────────────
 * 1. Connect to MySQL.
 * 2. reconcileScheduledArticleJobs() — RECOVERY
 *    Publishes any articles that became overdue while the server was offline,
 *    and re-enqueues future-scheduled articles into Redis/BullMQ in case the
 *    queue was flushed or the worker was down during the restart.
 * 3. startSchedulePoller() — FALLBACK
 *    Starts an in-process poll loop (configurable via ARTICLE_POLL_INTERVAL_MS,
 *    default 30 s) that publishes overdue articles even if the BullMQ worker
 *    is not running.  Can be disabled with ENABLE_ARTICLE_POLLING=false.
 * 4. Listen for HTTP requests.
 *
 * The BullMQ worker (article-publish-worker.js) runs as a SEPARATE process
 * and is the PRIMARY on-time scheduler.  Run it alongside this server:
 *   npm run worker:article-publish    (inside services/platform-service)
 *   npm run start:platform-worker     (from repo root — production)
 */

const config = require('./config');
const { createApp } = require('./app');
const { connect, sequelize } = require('./models');
const { reconcileScheduledArticleJobs, shutdownQueues } = require('./services/article-scheduling.service');
const { startSchedulePoller, stopSchedulePoller } = require('./services/article-poll.service');
const { logger } = require('../../../shared');

const app = createApp();
let server;

// ─── Startup ─────────────────────────────────────────────────────────────────

connect()
  .then(async () => {
    // Step 2: recovery — catch articles that went overdue while server was down
    await reconcileScheduledArticleJobs().catch((err) => {
      logger.error('[server] reconcile on startup failed', { message: err.message });
    });

    // Step 3: fallback polling loop inside this process
    startSchedulePoller();

    // Step 4: accept HTTP traffic
    if (!config.port) {
      throw new Error(
        'Missing required environment variable: PORT (set via npm script, e.g. cross-env PORT=4005)',
      );
    }
    server = app.listen(config.port, () => {
      logger.info(`[server] ${config.serviceName} listening`, { port: config.port });
      console.log(`${config.serviceName} listening on port ${config.port}`);
    });
  })
  .catch((err) => {
    logger.error('[server] fatal startup error', { message: err.message });
    process.exit(1);
  });

// ─── Graceful shutdown ───────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info(`[server] received ${signal} — shutting down`);

  // Stop polling loop first so no new DB work starts
  stopSchedulePoller();

  // Stop HTTP server from accepting new connections
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.info('[server] HTTP server closed');
  }

  // Close BullMQ queue + Redis connections
  await shutdownQueues();

  // Close Sequelize pool
  await sequelize.close().catch(() => {});
  logger.info('[server] MySQL pool closed');

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
