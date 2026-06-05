const config = require('./config');
const { createApp } = require('./app');
const { connect } = require('./models');
const { startOutboxWorker } = require('./workers/outbox.worker');
const { logger } = require('../../../shared');

const app = createApp();
connect()
  .then(() => {
    startOutboxWorker();
    app.listen(config.port, () =>
      logger.info(`${config.serviceName} listening on port ${config.port}`)
    );
  })
  .catch((err) => {
    logger.error('[order-service] Failed to start server', { error: err.message, stack: err.stack });
    process.exit(1);
  });
