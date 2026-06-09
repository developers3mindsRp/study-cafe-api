const path = require('path');
try {
  require('dotenv').config({
    path: path.join(__dirname, '../../../.env'),
    /** Never replace vars already set by the shell / npm scripts (e.g. PORT=4002 from dev:course). */
    override: false,
  });
} catch (_) {
  /* optional */
}

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
