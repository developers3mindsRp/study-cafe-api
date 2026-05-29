const axios = require('axios');
const Razorpay = require('razorpay');
const config = require('../config');

let cachedConfig = null;

async function getRazorpayConfig() {
  try {
    // 1. Try to fetch active dynamic database configuration first
    const { data } = await axios.get(`${config.adminServiceUrl}/internal/payment-config`, {
      headers: { 'X-Internal-API-Key': config.internalApiKey },
      timeout: 5000,
    });
    const finalData = data.data || data;
    if (finalData && finalData.key_id && finalData.key_secret) {
      cachedConfig = finalData;
      return finalData;
    }
  } catch (err) {
    const errMsg = err.response?.data?.error || err.message;
    console.warn(`[payment.service] Dynamic config load failed: ${errMsg}. Falling back to env...`);
  }

  // 2. Fallback to local environment variables
  if (config.razorpay.keyId && config.razorpay.keySecret) {
    return {
      key_id: config.razorpay.keyId,
      key_secret: config.razorpay.keySecret,
      webhook_secret: config.razorpay.webhookSecret || '',
    };
  }

  return cachedConfig || null;
}

async function getRazorpayInstance() {
  const cfg = await getRazorpayConfig();
  if (!cfg || !cfg.key_id || !cfg.key_secret) return null;
  return new Razorpay({ key_id: cfg.key_id, key_secret: cfg.key_secret });
}

module.exports = {
  getRazorpayConfig,
  getRazorpayInstance,
};
