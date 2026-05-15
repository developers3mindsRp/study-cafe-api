const axios = require('axios');

const platformClient = axios.create({
  baseURL: process.env.PLATFORM_SERVICE_URL || 'http://127.0.0.1:4005',
  timeout: 10000,
  headers: {
    'x-internal-api-key': process.env.INTERNAL_API_KEY || '',
  },
});

// Do not set a default Content-Type: axios adds application/json for plain objects.
// For multipart uploads (form-data package), merge boundary headers so multer receives the file.
platformClient.interceptors.request.use((config) => {
  if (config.data && typeof config.data.getHeaders === 'function') {
    Object.assign(config.headers, config.data.getHeaders());
  }
  return config;
});

// Unwrap internal service responses that use sendSuccess or sendPaginated
platformClient.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
    if ('meta' in response.data) {
      response.data = { data: response.data.data, ...response.data.meta };
    } else {
      response.data = response.data.data;
    }
  }
  return response;
});

module.exports = platformClient;
