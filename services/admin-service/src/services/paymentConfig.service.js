const { PaymentConfig, PaymentGateway } = require('../models');
const { logger, encryptSecret, decryptSecret } = require('../../../../shared');
const { decryptGatewayCredentials } = require('./paymentGateway.service');

async function getPaymentConfig() {
  try {
    const activeGateway = await PaymentGateway.findOne({
      where: { gateway_name: 'razorpay', is_active: 1 },
    });

    if (activeGateway) {
      return decryptGatewayCredentials(activeGateway);
    }
  } catch (err) {
    logger.error('[paymentConfigService] Failed to load from payment_gateways', {
      error: err.message,
    });
  }

  const row = await PaymentConfig.findByPk(1);
  const c = row ? row.get({ plain: true }) : {};
  return {
    key_id: decryptSecret(c.razorpay_key_id || ''),
    key_secret: decryptSecret(c.razorpay_key_secret || ''),
    webhook_secret: '',
  };
}

async function updatePaymentConfig({ razorpay_key_id, razorpay_key_secret }) {
  const [row] = await PaymentConfig.findOrCreate({
    where: { id: 1 },
    defaults: { razorpay_key_id: null, razorpay_key_secret: null },
  });
  await row.update({
    ...(razorpay_key_id !== undefined && {
      razorpay_key_id: razorpay_key_id ? encryptSecret(razorpay_key_id) : null,
    }),
    ...(razorpay_key_secret !== undefined && {
      razorpay_key_secret: razorpay_key_secret ? encryptSecret(razorpay_key_secret) : null,
    }),
  });
  const updated = await PaymentConfig.findByPk(1);
  return {
    updated: true,
    key_id: decryptSecret(updated?.razorpay_key_id || ''),
  };
}

module.exports = {
  getPaymentConfig,
  updatePaymentConfig,
};
