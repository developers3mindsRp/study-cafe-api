const axios = require('axios');
const config = require('../config');

const authClient = axios.create({
  baseURL: config.authServiceUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-internal-api-key': config.internalApiKey,
  },
});

authClient.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
    response.data = response.data.data;
  }
  return response;
});

module.exports = authClient;
