/**
 * Health-check endpoint: GET /health
 *
 * Returns a structured JSON document with the status of every subsystem:
 *   • MySQL  — authenticated connection ping
 *   • Redis  — PING round-trip
 *   • Queue  — BullMQ delayed / waiting / active / failed counts
 *   • Poller — whether the in-process fallback scheduler is running
 *
 * HTTP status codes:
 *   200 — all systems healthy
 *   503 — one or more systems degraded (body still contains full details)
 *
 * This endpoint is intentionally unauthenticated so load-balancer health
 * probes and monitoring tools can call it without credentials.
 */

const config = require('../config');
const { sequelize } = require('../models');
const { pingRedis } = require('../queues/redis.connection');
const { getArticlePublishQueue, queueName } = require('../queues/articlePublish.queue');
const { isPollerRunning } = require('../services/article-poll.service');

async function checkMySQL() {
  const t0 = Date.now();
  try {
    await sequelize.authenticate();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function checkQueue() {
  try {
    const q = getArticlePublishQueue();
    const counts = await q.getJobCounts('delayed', 'waiting', 'active', 'completed', 'failed');
    return { ok: true, name: queueName, counts };
  } catch (err) {
    return { ok: false, name: queueName, error: err.message };
  }
}

function register(router) {
  router.get('/health', async (_req, res) => {
    const [mysql, redis, queue] = await Promise.all([
      checkMySQL(),
      pingRedis(),
      checkQueue(),
    ]);

    const poller = {
      enabled: config.scheduling.enablePolling,
      running: isPollerRunning(),
      intervalMs: config.scheduling.pollIntervalMs,
    };

    const allOk = mysql.ok && redis.ok && queue.ok;

    const body = {
      status:    allOk ? 'ok' : 'degraded',
      service:   config.serviceName,
      timestamp: new Date().toISOString(),
      checks: { mysql, redis, queue, poller },
    };

    res.status(allOk ? 200 : 503).json(body);
  });
}

module.exports = { register };
