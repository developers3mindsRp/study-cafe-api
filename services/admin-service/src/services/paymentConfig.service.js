const { PaymentConfig, PaymentGateway } = require('../models');
const { logger } = require('../../../../shared');

async function getPaymentConfig() {
  try {
    // 1. Try to find the active razorpay gateway key
    const activeGateway = await PaymentGateway.findOne({
      where: { gateway_name: 'razorpay', is_active: 1 }
    });

    if (activeGateway) {
      return {
        key_id: activeGateway.key_id || '',
        key_secret: activeGateway.key_secret || '',
        webhook_secret: activeGateway.webhook_secret || ''
      };
    }
  } catch (err) {
    logger.error('[paymentConfigService] Failed to load from payment_gateways', {
      error: err.message,
    });
  }

  // 2. Fallback to old payment_config table if database table doesn't have active keys
  const row = await PaymentConfig.findByPk(1);
  const c = row ? row.get({ plain: true }) : {};
  return { 
    key_id: c.razorpay_key_id || '', 
    key_secret: c.razorpay_key_secret || '',
    webhook_secret: ''
  };
}

async function updatePaymentConfig({ razorpay_key_id, razorpay_key_secret }) {
  const [row] = await PaymentConfig.findOrCreate({
    where: { id: 1 },
    defaults: { razorpay_key_id: null, razorpay_key_secret: null },
  });
  await row.update({
    ...(razorpay_key_id !== undefined && { razorpay_key_id: razorpay_key_id || null }),
    ...(razorpay_key_secret !== undefined && { razorpay_key_secret: razorpay_key_secret || null }),
  });
  const updated = await PaymentConfig.findByPk(1);
  return { updated: true, key_id: updated?.razorpay_key_id || '' };
}

module.exports = {
  getPaymentConfig,
  updatePaymentConfig,
};