// Load env before ./config so SMTP_*, MYSQL_*, etc. apply (monorepo root .env is
// not auto-loaded by Node). Requiring the shared env module performs the load and
// honours APP_ENV / ENV_FILE, so `dev:prod` reaches .env.production here too.
require('../../../shared/env');
// Optional service-local override, kept from the original loader for parity with
// any deployment that ships one. No-op when absent; never overrides vars already set.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const config = require('./config');
const { createApp } = require('./app');
const { connect } = require('./models');
const { ensureCoreRolesAndUserAssignments } = require('./services/rolesBootstrap.service');
const { logger } = require('../../../shared');

const app = createApp();
connect()
  .then(() => ensureCoreRolesAndUserAssignments())
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
