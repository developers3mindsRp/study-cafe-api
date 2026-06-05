const IORedis = require('ioredis');
const config = require('../config');
const { logger } = require('../../../../shared');

/**
 * Named connection registry — avoids opening redundant connections.
 * BullMQ requires `maxRetriesPerRequest: null` on all connections it owns.
 * @type {Map<string, IORedis>}
 */
const _connections = new Map();

/**
 * Return (or lazily create) a named IORedis connection for BullMQ.
 *
 * @param {string} [name='default']
 * @returns {IORedis}
 */
function getRedisConnection(name = 'default') {
  if (_connections.has(name)) return _connections.get(name);

  const conn = new IORedis(config.redis.url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,    // BullMQ prefers this off
    lazyConnect: false,
  });

  conn.on('connect', () =>
    logger.info(`[redis:${name}] connected to ${config.redis.url.replace(/:[^:@]+@/, ':****@')}`),
  );
  conn.on('ready', () =>
    logger.info(`[redis:${name}] ready`),
  );
  conn.on('error', (err) =>
    logger.error(`[redis:${name}] error`, { message: err.message }),
  );
  conn.on('close', () =>
    logger.info(`[redis:${name}] connection closed`),
  );

  _connections.set(name, conn);
  return conn;
}

/**
 * Close all Redis connections gracefully (called during shutdown).
 * @returns {Promise<void>}
 */
async function closeAllRedisConnections() {
  const entries = [..._connections.entries()];
  await Promise.allSettled(
    entries.map(([name, conn]) =>
      conn
        .quit()
        .then(() => logger.info(`[redis:${name}] quit OK`))
        .catch((err) => logger.error(`[redis:${name}] quit error`, { message: err.message })),
    ),
  );
  _connections.clear();
}

/**
 * Ping Redis and return { ok, latencyMs, error? }.
 * Used by the health endpoint.
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
async function pingRedis() {
  const conn = getRedisConnection('default');
  const t0 = Date.now();
  try {
    await conn.ping();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** @deprecated Use getRedisConnection() */
function createRedisConnection() {
  return getRedisConnection('default');
}

module.exports = {
  getRedisConnection,
  createRedisConnection, // backward-compat alias kept for worker files
  closeAllRedisConnections,
  pingRedis,
};
