/**
 * Article Scheduling — Polling Fallback
 * ══════════════════════════════════════
 *
 * PURPOSE (FALLBACK)
 * ──────────────────
 * This service runs inside the API process itself and periodically scans
 * MySQL for articles whose scheduled_publish_at has passed.  It is the
 * second line of defence — the BullMQ worker (separate process) is the
 * primary scheduler.  If the worker is not running, this poller guarantees
 * articles are still published within ARTICLE_POLL_INTERVAL_MS (default 30 s).
 *
 * ENABLE / DISABLE
 * ────────────────
 * Controlled by the ENABLE_ARTICLE_POLLING environment variable (default: true).
 * Set ENABLE_ARTICLE_POLLING=false in environments that run a dedicated
 * BullMQ worker and want to save the periodic DB scan overhead.
 *
 * RACE-CONDITION SAFETY
 * ─────────────────────
 * All publishes go through atomicPublishArticle() which issues a single
 * conditional UPDATE (WHERE status = 'scheduled').  If multiple API replicas
 * or the BullMQ worker attempt to publish the same article simultaneously,
 * only the first UPDATE wins (affected rows = 1); the rest are silent no-ops
 * (affected rows = 0).  No double-publishing can occur.
 *
 * MULTI-INSTANCE DEPLOYMENTS
 * ──────────────────────────
 * When multiple API replicas run with polling enabled each replica will
 * independently execute the scan SQL and attempt the atomic UPDATE.
 * The atomic UPDATE prevents any article being published twice, but there
 * will be N redundant SELECTs per interval (N = replica count).
 *
 * RECOMMENDATION for production with >1 replica:
 *   • Set ENABLE_ARTICLE_POLLING=false on all API replicas.
 *   • Run exactly one article-publish-worker process (or scale it separately).
 *   • The worker handles precise on-time delivery; reconcile on each API
 *     startup handles the rare "overdue at boot" edge case.
 */

const { Op } = require('sequelize');
const { logger } = require('../../../../shared');
const config = require('../config');
const { activeRowWhere } = require('../../../../shared');
const { atomicPublishArticle } = require('./article-scheduling.service');
const { Article } = require('../models');

/** Whether polling is enabled at all (read once at module load). */
const POLLING_ENABLED = config.scheduling.enablePolling;
const POLL_INTERVAL_MS = config.scheduling.pollIntervalMs;

let _timer = null;
let _running = false; // lightweight re-entrancy guard for slow DB responses

async function pollAndPublishDue() {
  if (_running) return;
  _running = true;
  try {
    const now = new Date();

    // Select only the minimum columns needed — avoids fetching article body
    const rows = await Article.findAll({
      where: {
        status: 'scheduled',
        scheduled_publish_at: { [Op.lte]: now },
        ...activeRowWhere(),
      },
      attributes: ['id', 'scheduled_publish_at'],
    });

    if (rows.length === 0) return;

    logger.info('[article-poll] due articles found', { count: rows.length });

    for (const r of rows) {
      const { id, scheduled_publish_at } = r.get({ plain: true });
      const publishedAt = scheduled_publish_at ? new Date(scheduled_publish_at) : now;
      try {
        const published = await atomicPublishArticle(id, publishedAt);
        if (published) {
          logger.info('[article-poll] published scheduled article', {
            articleId: id,
            scheduled_for: publishedAt.toISOString(),
          });
        }
        // published=false means another process/layer already handled it — silent skip
      } catch (err) {
        logger.error('[article-poll] failed to publish article', {
          articleId: id,
          message: err.message,
        });
      }
    }
  } catch (err) {
    logger.error('[article-poll] poll cycle error', { message: err.message });
  } finally {
    _running = false;
  }
}

/**
 * Start the polling loop.
 * No-op if polling is disabled via ENABLE_ARTICLE_POLLING=false.
 */
function startSchedulePoller() {
  if (!POLLING_ENABLED) {
    logger.info('[article-poll] poller disabled (ENABLE_ARTICLE_POLLING=false)');
    return;
  }
  if (_timer) return; // already running

  logger.info('[article-poll] poller started', {
    intervalMs: POLL_INTERVAL_MS,
    note: 'FALLBACK safety net — BullMQ worker is the primary scheduler',
  });

  _timer = setInterval(pollAndPublishDue, POLL_INTERVAL_MS);
  if (_timer.unref) _timer.unref(); // don't block process exit

  // Run once immediately to catch anything overdue since last restart
  pollAndPublishDue().catch(() => {});
}

/**
 * Stop the polling loop (called during graceful shutdown).
 */
function stopSchedulePoller() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('[article-poll] poller stopped');
  }
}

/** @returns {boolean} current running state — used by health endpoint */
function isPollerRunning() {
  return POLLING_ENABLED && _timer !== null;
}

module.exports = {
  startSchedulePoller,
  stopSchedulePoller,
  pollAndPublishDue,
  isPollerRunning,
};
