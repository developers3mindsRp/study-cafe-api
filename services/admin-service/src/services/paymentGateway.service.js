'use strict';

const { PaymentGateway, sequelize } = require('../models');
const { AppError } = require('../../../../shared');

async function listPaymentGateways() {
  return PaymentGateway.findAll({
    order: [['created_at', 'DESC']]
  });
}

async function getPaymentGatewayById(id) {
  const item = await PaymentGateway.findByPk(id);
  if (!item) throw new AppError('Payment gateway configuration not found', 404);
  return item;
}

async function createPaymentGateway(data) {
  const { name, gateway_name, key_id, key_secret, webhook_secret, is_active } = data;
  if (!name || !key_id || !key_secret) {
    throw new AppError('Name, key ID, and key secret are required', 400);
  }

  return sequelize.transaction(async (t) => {
    if (is_active) {
      // Deactivate all other configurations for this gateway
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
}

async function updatePaymentGateway(id, data) {
  const item = await PaymentGateway.findByPk(id);
  if (!item) throw new AppError('Payment gateway configuration not found', 404);

  const { name, gateway_name, key_id, key_secret, webhook_secret, is_active } = data;

  return sequelize.transaction(async (t) => {
    if (is_active && !item.is_active) {
      // Activating this key, deactivate all other keys for the same gateway
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
}

async function deletePaymentGateway(id) {
  const item = await PaymentGateway.findByPk(id);
  if (!item) throw new AppError('Payment gateway configuration not found', 404);

  if (item.is_active) {
    throw new AppError('Cannot delete the currently active configuration. Please activate another configuration first.', 400);
  }

  await item.destroy();
  return { deleted: true };
}

module.exports = {
  listPaymentGateways,
  getPaymentGatewayById,
  createPaymentGateway,
  updatePaymentGateway,
  deletePaymentGateway
};
