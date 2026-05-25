const axios = require('axios');
const config = require('../config');

const platformClient = axios.create({
  baseURL: config.platformServiceUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-internal-api-key': config.internalApiKey,
  },
});

platformClient.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
    response.data = response.data.data;
  }
  return response;
});

module.exports = platformClient;
