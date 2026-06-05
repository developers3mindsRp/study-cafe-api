const { logger } = require('../../../../shared');

function errorHandler(err, req, res, next) {
  logger.error('[api-gateway] Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req?.originalUrl,
    method: req?.method,
  });
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler };
