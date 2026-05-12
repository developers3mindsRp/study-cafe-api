const path = require('path');
const dotenv = require('dotenv');

// Load env in priority order: service-local .env overrides the monorepo root .env
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    // Warn loudly but don't crash — some vars are optional in dev
    console.warn(`[config] WARNING: environment variable "${name}" is not set.`);
  }
  return v || '';
}

function optional(name, fallback = '') {
  return process.env[name] ?? fallback;
}

function intOpt(name, fallback) {
  const v = process.env[name];
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function boolOpt(name, fallback = false) {
  const v = String(process.env[name] ?? '').toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

// ---------------------------------------------------------------------------
// Config object
// ---------------------------------------------------------------------------

module.exports = {
  env: optional('NODE_ENV', 'development'),
  port: intOpt('PORT', 4005),
  serviceName: 'platform-service',

  /** JWT secret — used only for optional Bearer parsing on public article routes. */
  jwt: {
    secret: optional('JWT_SECRET', ''),
  },

  mysql: {
    host:             optional('MYSQL_HOST', '127.0.0.1'),
    port:             intOpt('MYSQL_PORT', 3306),
    user:             optional('MYSQL_USER', 'studycafe_user'),
    password:         optional('MYSQL_PASSWORD', ''),
    database:         optional('MYSQL_DATABASE', 'studycafe_db'),
    connectionLimit:  intOpt('MYSQL_POOL_SIZE', 10),
    queueLimit:       0,
    waitForConnections: true,
  },

  internalApiKey: optional('INTERNAL_API_KEY', ''),

  smtp: {
    host: optional('SMTP_HOST', ''),
    port: intOpt('SMTP_PORT', 587),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('SMTP_FROM', 'no-reply@studycafe.local'),
  },

  publicBaseUrl: optional('PUBLIC_BASE_URL', 'http://localhost:3000'),

  redis: {
    /** Full ioredis URL. Required for BullMQ. Falls back to localhost only in development. */
    url: optional('REDIS_URL', 'redis://127.0.0.1:6379'),
  },

  articlePublishQueue: {
    /** BullMQ queue name — must match across API and worker. */
    name: optional('ARTICLE_PUBLISH_QUEUE_NAME', 'article-publish'),
    /**
     * How many jobs the worker processes in parallel.
     * 1-5 is sufficient for article publishing; raise only if publishing
     * involves heavy async I/O and the DB can handle the parallel load.
     */
    workerConcurrency: intOpt('ARTICLE_PUBLISH_WORKER_CONCURRENCY', 5),
  },

  /**
   * Polling fallback scheduler.
   * Set ENABLE_ARTICLE_POLLING=false to disable in environments that rely
   * exclusively on the BullMQ worker (e.g. production with a dedicated worker).
   * Default: true — safe for single-process / dev deploys.
   *
   * IMPORTANT — multi-instance deployments:
   * When multiple API replicas run with polling enabled each replica will
   * independently scan for due articles. The atomic UPDATE (WHERE status='scheduled')
   * prevents double-publishing, but there is minor extra DB load.
   * In a multi-replica setup it is strongly recommended to set
   * ENABLE_ARTICLE_POLLING=false on all replicas and run a dedicated
   * article-publish-worker instead.
   */
  scheduling: {
    enablePolling:      boolOpt('ENABLE_ARTICLE_POLLING', true),
    pollIntervalMs:     intOpt('ARTICLE_POLL_INTERVAL_MS', 30_000),
  },
};
