'use strict';

const { PaymentGateway, sequelize } = require('../models');
const { AppError, logger } = require('../../../../shared');

async function listPaymentGateways() {
  try {
    return await PaymentGateway.findAll({
      order: [['created_at', 'DESC']]
    });
  } catch (err) {
    logger.error('[paymentGateway] listPaymentGateways failed', { error: err.message });
    throw err;
  }
}

async function getPaymentGatewayById(id) {
  try {
    const item = await PaymentGateway.findByPk(id);
    if (!item) throw new AppError('Payment gateway configuration not found', 404);
    return item;
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentGateway] getPaymentGatewayById failed', { error: err.message, id });
    }
    throw err;
  }
}

async function createPaymentGateway(data) {
  const { name, gateway_name, key_id, key_secret, webhook_secret, is_active } = data;
  if (!name || !key_id || !key_secret) {
    throw new AppError('Name, key ID, and key secret are required', 400);
  }

  try {
    return await sequelize.transaction(async (t) => {
      if (is_active) {
        await PaymentGateway.update(
          { is_active: 0 },
          { where: { gateway_name: gateway_name || 'razorpay' }, transaction: t }
        );
      }

      return PaymentGateway.create({
        name,
        gateway_name: gateway_name || 'razorpay',
        key_id,
        key_secret,
        webhook_secret: webhook_secret || null,
        is_active: is_active ? 1 : 0
      }, { transaction: t });
    });
  } catch (err) {
    logger.error('[paymentGateway] createPaymentGateway failed', {
      error: err.message,
      payload: { name, gateway_name, is_active },
    });
    throw err;
  }
}

async function updatePaymentGateway(id, data) {
  try {
    const item = await PaymentGateway.findByPk(id);
    if (!item) throw new AppError('Payment gateway configuration not found', 404);

    const { name, gateway_name, key_id, key_secret, webhook_secret, is_active } = data;

    return await sequelize.transaction(async (t) => {
      if (is_active && !item.is_active) {
        await PaymentGateway.update(
          { is_active: 0 },
          { where: { gateway_name: item.gateway_name }, transaction: t }
        );
      }

      await item.update({
        ...(name !== undefined && { name }),
        ...(gateway_name !== undefined && { gateway_name }),
        ...(key_id !== undefined && { key_id }),
        ...(key_secret !== undefined && { key_secret }),
        ...(webhook_secret !== undefined && { webhook_secret: webhook_secret || null }),
        ...(is_active !== undefined && { is_active: is_active ? 1 : 0 }),
      }, { transaction: t });

      return item.reload({ transaction: t });
    });
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentGateway] updatePaymentGateway failed', {
        error: err.message,
        id,
        payload: data,
      });
    }
    throw err;
  }
}

async function deletePaymentGateway(id) {
  try {
    const item = await PaymentGateway.findByPk(id);
    if (!item) throw new AppError('Payment gateway configuration not found', 404);

    if (item.is_active) {
      throw new AppError('Cannot delete the currently active configuration. Please activate another configuration first.', 400);
    }

    await item.destroy();
    return { deleted: true };
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentGateway] deletePaymentGateway failed', { error: err.message, id });
    }
    throw err;
  }
}

module.exports = {
  listPaymentGateways,
  getPaymentGatewayById,
  createPaymentGateway,
  updatePaymentGateway,
  deletePaymentGateway
};
