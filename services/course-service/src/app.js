const path = require('path');
const express = require('express');
const cors = require('cors');
const { logger } = require('../../../shared');
const routes = require('./routes');
const { errorHandler } = require('./middleware');
const config = require('./config');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const uploadRoot = path.isAbsolute(config.certificatesUploadDir)
    ? config.certificatesUploadDir
    : path.join(process.cwd(), config.certificatesUploadDir);
  app.use('/uploads/certificates', express.static(uploadRoot));
  app.use(logger.requestLogger);
  app.use(routes);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
