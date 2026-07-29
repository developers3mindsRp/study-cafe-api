/**
 * Loads the resolved env file (honours APP_ENV / ENV_FILE, so `dev:prod` reaches
 * .env.production) and never replaces vars already set by the shell / npm scripts
 * (e.g. PORT=4002 from dev:course).
 */
require('../../../shared/env');

const config = require('./config');
const { createApp } = require('./app');
const { connect, sequelize } = require('./models');
const { logger } = require('../../../shared');
const { ensureAffiliateExpirySchema } = require('./bootstrap/ensureAffiliateExpirySchema');

const app = createApp();

connect()
  .then(async () => {
    await ensureAffiliateExpirySchema(sequelize);
    app.listen(config.port, () =>
      logger.info(`${config.serviceName} listening on port ${config.port}`)
    );
  })
  .catch((err) => {
    logger.error('[course-service] Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  });
