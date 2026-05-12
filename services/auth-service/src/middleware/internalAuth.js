const config = require('../config');

function internalAuth(req, res, next) {
  const key = req.headers['x-internal-api-key'];
  if (config.internalApiKey && key === config.internalApiKey) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { internalAuth };
