const axios = require('axios');
const { logger } = require('../../../../shared');
const config = require('../config');

/**
 * Ask auth-service whether the bearer may access course content.
 */
async function checkCourseAccess(authHeader, courseId) {
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) return false;
  const base = config.authServiceUrl?.replace(/\/$/, '') || '';
  const url = `${base}/access/check`;
  try {
    const { data } = await axios.get(url, {
      params: { courseId },
      headers: { Authorization: authHeader },
      timeout: 8000,
      validateStatus: (s) => s === 200,
    });
    const finalData = data && data.data !== undefined ? data.data : data;
    return !!finalData?.allowed;
  } catch (err) {
    const code = err.code || err.cause?.code;
    const hint =
      code === 'ECONNREFUSED' || code === 'ENOTFOUND'
        ? ` Is AUTH_SERVICE_URL correct for this runtime? (got ${base || '(empty)'}).`
        : '';
    logger.warn(`[accessClient] access/check failed for courseId=${courseId}: ${err.message}.${hint}`);
    return false;
  }
}

module.exports = { checkCourseAccess };
