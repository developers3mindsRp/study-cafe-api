const express = require('express');
const cors = require('cors');
const { logger } = require('../../../shared');
const routes = require('./routes');
const { errorHandler } = require('./middleware');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(logger.requestLogger);
  app.use(routes);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
