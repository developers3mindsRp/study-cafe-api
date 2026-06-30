const { getRedis } = require('../config/redis');
const config = require('../config');
const { markGatewayOnlyLog } = require('../../../../shared/apiRequestLogger');

async function rateLimit(req, res, next) {
  try {
    const redis = await getRedis();
    const key = `ratelimit:${req.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, config.rateLimit.windowSec);
    if (count > config.rateLimit.maxPerWindow) {
      markGatewayOnlyLog(req);
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  } catch (err) {
    next();
  }
}

module.exports = { rateLimit };
