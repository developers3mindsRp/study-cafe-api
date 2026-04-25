const config = require('../config');

function register(router) {
  router.get('/health', (req, res) =>
    res.json({ status: 'ok', service: config.serviceName })
  );
}

module.exports = { register };
