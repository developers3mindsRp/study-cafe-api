const axios = require('axios');
const config = require('../config');

/** Skip JWT for CORS preflight — browser sends OPTIONS without Authorization. */
function validateJWTUnlessOptions(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  return validateJWT(req, res, next);
}

async function validateJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }
  const token = auth.slice(7);
  try {
    const { data: body } = await axios.get(`${config.authServiceUrl}/auth/validate`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    });
    // sendSuccess → { success, data: { userId, id, ... } }
    const finalData =
      body && typeof body === 'object' && body.data != null && typeof body.data === 'object'
        ? body.data
        : body;
    req.user = finalData;
    next();
  } catch (err) {
    const status = err.response?.status || 500;
    const body = err.response?.data || { error: 'Validation failed' };
    res.status(status).json(body);
  }
}

function optionalJWT(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return next();
  const token = auth.slice(7);
  axios
    .get(`${config.authServiceUrl}/auth/validate`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 5000,
    })
    .then(({ data: body }) => {
      const finalData =
        body && typeof body === 'object' && body.data != null && typeof body.data === 'object'
          ? body.data
          : body;
      req.user = finalData;
      next();
    })
    .catch(() => next());
}

async function requireCourseAccess(req, res, next) {
  const courseId = req.params.id;
  if (!courseId) return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required to access course content' });
  }
  try {
    const { data } = await axios.get(`${config.authServiceUrl}/access/check`, {
      params: { courseId },
      headers: { Authorization: auth },
      timeout: 5000,
    });
    const finalData = data.data || data;
    if (!finalData.allowed) {
      return res.status(403).json({ error: 'Access denied to this course' });
    }
    next();
  } catch (err) {
    const status = err.response?.status || 403;
    const body = err.response?.data || { error: 'Access check failed' };
    res.status(status).json(body);
  }
}

module.exports = {
  validateJWT,
  validateJWTUnlessOptions,
  optionalJWT,
  requireCourseAccess,
};
