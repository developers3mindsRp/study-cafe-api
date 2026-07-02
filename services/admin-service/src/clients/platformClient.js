const axios = require('axios');
const config = require('../config');

const platformClient = axios.create({
  baseURL: config.platformServiceUrl,
  // 30s: a large article create (content + taxonomy + section rows) can exceed the
  // old 10s limit; when the proxy aborted mid-insert the client saw an error while
  // platform-service still committed the row, causing duplicate articles on retry.
  timeout: 30000,
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
