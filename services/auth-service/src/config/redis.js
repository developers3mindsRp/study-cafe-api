const Redis = require('redis');
const config = require('./index');
const { logger } = require('../../../../shared');

let client;

async function getRedis() {
  if (!client) {
    client = Redis.createClient({ url: config.redis.url });
    client.on('error', (err) => logger.error('[auth] Redis client error', { error: err.message }));
    await client.connect();
  }
  return client;
}

module.exports = { getRedis };
