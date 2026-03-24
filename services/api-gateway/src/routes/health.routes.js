const config = require('../config');

function register(router) {
  router.get('/', (req, res) =>
    res.status(200).send(
      "<body style=\"font-family: Helvetica !important; background-color: black\">" +
      "<div style=\"display: flex; flex:1; height: 100% ; justify-content: center; align-items: center; min-height: 100vh !important; font-size: 24px !important; color: #605DFF !important;\">" +
      "⚡ API Gateway 🔗 All MicroServices are working fine 🔋" +
      "</div></body>"
    )
  );
  router.get('/health', (req, res) =>
    res.json({ status: 'ok', service: config.serviceName })
  );
}

module.exports = { register };

