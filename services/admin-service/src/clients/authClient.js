const axios = require('axios');

const authClient = axios.create({
  baseURL: process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:4001',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-internal-api-key': process.env.INTERNAL_API_KEY || '',
  },
});

authClient.interceptors.response.use((response) => {
  if (response.data && typeof response.data === 'object' && response.data.success === true && 'data' in response.data) {
    response.data = response.data.data;
  }
  return response;
});

module.exports = authClient;
