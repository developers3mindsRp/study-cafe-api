const axios = require('axios');
const Razorpay = require('razorpay');
const config = require('../config');
const { logger, detectRazorpayKeyMode } = require('../../../../shared');

let cachedConfig = null;

function maskKeyId(keyId) {
  const id = String(keyId || '');
  if (id.length <= 12) return id;
  return `${id.slice(0, 12)}…`;
}

function logConfigSource(source, cfg) {
  const mode = detectRazorpayKeyMode(cfg?.key_id);
  logger.info('[payment.service] Razorpay config loaded', {
    source,
    key_id: maskKeyId(cfg?.key_id),
    mode,
  });
}

function envRazorpayConfig() {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) return null;
  return {
    key_id: config.razorpay.keyId,
    key_secret: config.razorpay.keySecret,
    webhook_secret: config.razorpay.webhookSecret || '',
  };
}

function adminUnreachable(err) {
  if (!err) return false;
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
    return true;
  }
  const status = err.response?.status;
  return status >= 500 || status === 502 || status === 503 || status === 504;
}

async function fetchDynamicPaymentConfig() {
  const { data } = await axios.get(`${config.adminServiceUrl}/internal/payment-config`, {
    headers: { 'X-Internal-API-Key': config.internalApiKey },
    timeout: 5000,
    validateStatus: () => true,
  });

  if (data && typeof data === 'object' && data.success === false) {
    const message = data.message || data.error || 'Admin payment-config rejected request';
    const err = new Error(message);
    err.response = { status: 502, data };
    throw err;
  }

  if (data && typeof data === 'object' && data.success === true && 'data' in data) {
    return data.data;
  }

  return data;
}

async function getRazorpayConfig() {
  let dynamicError = null;
  let dynamicEmpty = false;
  const isProduction = process.env.NODE_ENV === 'production';

  try {
    const finalData = await fetchDynamicPaymentConfig();
    if (finalData?.key_id && finalData?.key_secret) {
      cachedConfig = finalData;
      logConfigSource('database', finalData);
      return finalData;
    }
    dynamicEmpty = true;
    logger.error(
      '[payment.service] Active payment gateway in admin returned no keys. ' +
        'Check /settings/global/payment-gateway and restart admin-service after changes.'
    );
  } catch (err) {
    dynamicError = err;
    const errMsg = err.response?.data?.error || err.response?.data?.message || err.message;
    logger.warn(`[payment.service] Dynamic config load failed: ${errMsg}`);
  }

  if (cachedConfig?.key_id && cachedConfig?.key_secret) {
    logConfigSource('cache', cachedConfig);
    return cachedConfig;
  }

  const envCfg = envRazorpayConfig();
  if (envCfg) {
    if (adminUnreachable(dynamicError)) {
      logger.warn(
        '[payment.service] Admin service unreachable — using RAZORPAY_* from .env as emergency fallback'
      );
      logConfigSource('env-fallback', envCfg);
      return envCfg;
    }

    if (dynamicEmpty && !isProduction) {
      logger.warn(
        '[payment.service] Development: using RAZORPAY_* from .env because active admin gateway keys are missing or cannot be decrypted. ' +
          'Re-save credentials in Admin → Payment Gateway, or fix PAYMENT_SECRETS_ENCRYPTION_KEY.'
      );
      logConfigSource('env-dev', envCfg);
      return envCfg;
    }

    if (dynamicEmpty) {
      logger.error(
        '[payment.service] Ignoring RAZORPAY_* from .env because admin has no active gateway keys. ' +
          `Env key ${maskKeyId(envCfg.key_id)} (${detectRazorpayKeyMode(envCfg.key_id)}) would override live DB settings. ` +
          'Remove RAZORPAY_KEY_ID/SECRET from .env or fix the active gateway in admin.'
      );
      return null;
    }
  }

  return null;
}

function clearRazorpayConfigCache() {
  cachedConfig = null;
}

async function getRazorpayInstance() {
  const cfg = await getRazorpayConfig();
  if (!cfg || !cfg.key_id || !cfg.key_secret) return null;
  return new Razorpay({ key_id: cfg.key_id, key_secret: cfg.key_secret });
}

module.exports = {
  getRazorpayConfig,
  getRazorpayInstance,
  clearRazorpayConfigCache,
};
