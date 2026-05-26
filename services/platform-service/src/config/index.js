const path = require('path');
const dotenv = require('dotenv');
const {
  required,
  requiredInt,
  optionalInt,
  requiredBool,
  readOptional,
  mysqlConfig,
  serviceUrl,
} = require('../../../../shared/env');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

module.exports = {
  env: required('NODE_ENV'),
  /** Set via cross-env in npm scripts / PM2 for the HTTP server only; workers omit PORT. */
  port: optionalInt('PORT'),
  serviceName: 'platform-service',
  jwt: {
    secret: required('JWT_SECRET'),
  },
  mysql: mysqlConfig(),
  internalApiKey: required('INTERNAL_API_KEY'),
  orderServiceUrl: serviceUrl('ORDER_SERVICE_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: requiredInt('SMTP_PORT'),
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
    from: required('SMTP_FROM'),
  },

  publicBaseUrl: readOptional('PUBLIC_BASE_URL'),
  /** Public website URL for email CTAs (align with auth-service PUBLIC_SITE_URL) */
  publicSiteUrl: (readOptional('PUBLIC_SITE_URL') || '').replace(/\/+$/, ''),
  /** Inbox for Contact Us form admin notifications */
  contactAdminEmail: readOptional('CONTACT_ADMIN_EMAIL'),

  redis: {
    url: required('REDIS_URL'),
  },
  articlePublishQueue: {
    name: required('ARTICLE_PUBLISH_QUEUE_NAME'),
    workerConcurrency: requiredInt('ARTICLE_PUBLISH_WORKER_CONCURRENCY'),
  },
  scheduling: {
    enablePolling: requiredBool('ENABLE_ARTICLE_POLLING'),
    pollIntervalMs: requiredInt('ARTICLE_POLL_INTERVAL_MS'),
  },
};

process.env.SERVICE_NAME = module.exports.serviceName;
