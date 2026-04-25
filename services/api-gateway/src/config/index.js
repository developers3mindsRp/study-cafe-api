module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  serviceName: 'api-gateway',
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  courseServiceUrl: process.env.COURSE_SERVICE_URL || 'http://localhost:4002',
  orderServiceUrl: process.env.ORDER_SERVICE_URL || 'http://localhost:4003',
  adminServiceUrl: process.env.ADMIN_SERVICE_URL || 'http://localhost:4004',
  platformServiceUrl: process.env.PLATFORM_SERVICE_URL || 'http://localhost:4005',
  downloadsServiceUrl: process.env.DOWNLOADS_SERVICE_URL || 'http://localhost:4006',
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  rateLimit: {
    windowSec: parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10),
    maxPerWindow: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },
  /** Injected on proxy to downloads-service internal routes (admin panel). */
  internalApiKey: process.env.INTERNAL_API_KEY || '',
};
