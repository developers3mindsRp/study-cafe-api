const axios = require('axios');
const config = require('../config');

const courseClient = axios.create({
  baseURL: config.courseServiceUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-internal-api-key': config.internalApiKey,
  },
});

courseClient.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
    response.data = response.data.data;
  }
  return response;
});

module.exports = courseClient;
