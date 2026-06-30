const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { errorHandler } = require('./middleware');
const { logger } = require('../../../shared');
const { createApiRequestLoggerMiddleware } = require('../../../shared/apiRequestLogger');
const { uploadDir } = require('./middleware/avatarUpload');

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json());
  app.use(createApiRequestLoggerMiddleware());
  app.use(logger.requestLogger);
  /** Public URLs for profile avatars (gateway: /api/user-uploads → here) */
  app.use('/user-uploads', express.static(uploadDir));
  app.use(routes);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
