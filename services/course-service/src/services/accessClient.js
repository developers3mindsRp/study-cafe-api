const axios = require('axios');
const config = require('../config');

/**
 * Ask auth-service whether the bearer may access course content.
 */
async function checkCourseAccess(authHeader, courseId) {
  if (!authHeader || !String(authHeader).startsWith('Bearer ')) return false;
  try {
    const { data } = await axios.get(`${config.authServiceUrl}/access/check`, {
      params: { courseId },
      headers: { Authorization: authHeader },
      timeout: 8000,
      validateStatus: (s) => s === 200,
    });
    const finalData = data && data.data !== undefined ? data.data : data;
    return !!finalData?.allowed;
  } catch {
    return false;
  }
}

module.exports = { checkCourseAccess };
