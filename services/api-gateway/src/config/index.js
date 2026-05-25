const {
  required,
  requiredInt,
  serviceUrl,
} = require('../../../../shared/env');

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'api-gateway',
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL'),
  courseServiceUrl: serviceUrl('COURSE_SERVICE_URL'),
  orderServiceUrl: serviceUrl('ORDER_SERVICE_URL'),
  adminServiceUrl: serviceUrl('ADMIN_SERVICE_URL'),
  platformServiceUrl: serviceUrl('PLATFORM_SERVICE_URL'),
  downloadsServiceUrl: serviceUrl('DOWNLOADS_SERVICE_URL'),
  redis: {
    url: required('REDIS_URL'),
  },
  rateLimit: {
    windowSec: requiredInt('RATE_LIMIT_WINDOW'),
    maxPerWindow: requiredInt('RATE_LIMIT_MAX'),
  },
  internalApiKey: required('INTERNAL_API_KEY'),
};

process.env.SERVICE_NAME = module.exports.serviceName;
