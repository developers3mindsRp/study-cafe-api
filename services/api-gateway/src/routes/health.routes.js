const axios = require('axios');
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

  /** Quick check that gateway can reach course-service (same hop as /api/course-cats). */
  router.get('/health/course-service', async (_req, res) => {
    const base = config.courseServiceUrl.replace(/\/$/, '');
    try {
      const r = await axios.get(`${base}/health`, { timeout: 5000 });
      res.json({
        ok: true,
        courseServiceUrl: base,
        courseService: r.data,
      });
    } catch (e) {
      res.status(503).json({
        ok: false,
        courseServiceUrl: base,
        error: e?.message || String(e),
        code: e?.code,
        hint:
          'Start course-service (default port 4002). Gateway uses COURSE_SERVICE_URL in api-gateway env.',
      });
    }
  });
}

module.exports = { register };

