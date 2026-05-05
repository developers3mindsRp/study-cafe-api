const path = require('path');
const dotenv = require('dotenv');

// Load env before ./config so SMTP_*, MYSQL_*, etc. apply (monorepo root .env is not auto-loaded by Node).
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const config = require('./config');
const { createApp } = require('./app');
const { connect } = require('./models');
const { logger } = require('../../../shared');

const app = createApp();
connect()
  .then(() => {
    app.listen(config.port, () => {
      logger.info(`${config.serviceName} listening on port ${config.port}`);
      const emailService = require('./services/email.service');
      if (emailService.isSmtpConfigured()) {
        logger.info('[email] SMTP enabled for OTP (signup + login)');
      } else {
        logger.warn(
          '[email] SMTP not configured (missing SMTP_HOST or SMTP_USER) — OTP is not emailed. Ensure study-cafe-api/.env is loaded from repo root.'
        );
      }
    });
  })
  .catch((err) => {
    logger.error('Failed to start', { error: err.message, stack: err.stack });
    process.exit(1);
  });
