const {
  required,
  requiredInt,
  mysqlConfig,
  serviceUrl,
  readOptional,
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
    keyId: readOptional('RAZORPAY_KEY_ID'),
    keySecret: readOptional('RAZORPAY_KEY_SECRET'),
    webhookSecret: readOptional('RAZORPAY_WEBHOOK_SECRET'),
  },
  outbox: {
    pollMs: requiredInt('OUTBOX_POLL_MS'),
  },
  pabblyWebhookUrl: readOptional('PABBLY_WEBHOOK_URL'),
};

process.env.SERVICE_NAME = module.exports.serviceName;
