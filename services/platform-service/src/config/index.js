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

  /**
   * Telegram auto-publishing. When enabled and credentials are present, every
   * article that becomes published is posted to the configured group/channel.
   * All fields optional so the service boots without them (integration simply
   * stays inactive). See services/telegram.service.js.
   */
  telegram: {
    botToken: readOptional('TELEGRAM_BOT_TOKEN'),
    chatId: readOptional('TELEGRAM_CHAT_ID'),
    // Default ON; set TELEGRAM_PUBLISH_ENABLED=false to mute posting.
    enabled: (() => {
      const raw = readOptional('TELEGRAM_PUBLISH_ENABLED');
      if (raw === undefined) return true;
      return ['true', '1'].includes(raw.toLowerCase());
    })(),
    apiBaseUrl: (readOptional('TELEGRAM_API_BASE_URL') || 'https://api.telegram.org').replace(/\/+$/, ''),
    // Base for the article link posted to Telegram. Uses the legacy WordPress
    // permalink form `<base>/<slug>-<id>.html`, so this must point at the public
    // site that serves those URLs (studycafe.in). Override with
    // TELEGRAM_ARTICLE_BASE_URL; otherwise falls back to FRONTEND_URL, then
    // PUBLIC_SITE_URL.
    articleBaseUrl: (
      readOptional('TELEGRAM_ARTICLE_BASE_URL')
      || readOptional('FRONTEND_URL')
      || readOptional('PUBLIC_SITE_URL')
      || ''
    ).replace(/\/+$/, ''),
  },
};

process.env.SERVICE_NAME = module.exports.serviceName;
