const {
  required,
  requiredInt,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

module.exports = {
  port: requiredInt('PORT'),
  serviceName: 'order-service',
  mysql: mysqlConfig(),
  redis: {
    url: required('REDIS_URL'),
  },
  authServiceUrl: serviceUrl('AUTH_SERVICE_URL'),
  courseServiceUrl: serviceUrl('COURSE_SERVICE_URL'),
  platformServiceUrl: serviceUrl('PLATFORM_SERVICE_URL'),
  adminServiceUrl: serviceUrl('ADMIN_SERVICE_URL'),
  internalApiKey: required('INTERNAL_API_KEY'),
  razorpay: {
    keyId: required('RAZORPAY_KEY_ID'),
    keySecret: required('RAZORPAY_KEY_SECRET'),
    webhookSecret: required('RAZORPAY_WEBHOOK_SECRET'),
  },
  outbox: {
    pollMs: requiredInt('OUTBOX_POLL_MS'),
  },
};

process.env.SERVICE_NAME = module.exports.serviceName;
