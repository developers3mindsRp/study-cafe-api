const express = require('express');
const cors = require('cors');
const { logger } = require('../../../shared');
const routes = require('./routes');
const { errorHandler } = require('./middleware');

function createApp() {
  const app = express();
  app.use(cors());
  /** Large HTML/script blobs (Global Settings pixels, GTM) exceed the default ~100kb limit */
  app.use(express.json({ limit: '15mb' }));
  app.use(logger.requestLogger);
  app.use(routes);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
