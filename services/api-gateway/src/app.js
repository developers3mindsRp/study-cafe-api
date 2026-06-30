const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { router, proxyRoutes } = require('./routes');
const { errorHandler } = require('./middleware');
const {
  createApiRequestLoggerMiddleware,
  createGatewayRequestContextMiddleware,
} = require('../../../shared/apiRequestLogger');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(createGatewayRequestContextMiddleware());
  app.use(createApiRequestLoggerMiddleware({ role: 'gateway' }));
  app.use(morgan('combined'));
  app.use(router);
  proxyRoutes.register(app);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
