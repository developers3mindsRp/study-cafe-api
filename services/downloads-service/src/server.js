const config = require('./config');
const { createApp } = require('./app');
const { connect } = require('./models');
const { logger } = require('../../../shared');

const app = createApp();

connect()
  .then(() => {
    app.listen(config.port, () =>
      logger.info(`${config.serviceName} listening on port ${config.port}`)
    );
  })
  .catch((err) => {
    logger.error('[downloads-service] Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  });
