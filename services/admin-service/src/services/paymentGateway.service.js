'use strict';

const { PaymentGateway, sequelize } = require('../models');
const { AppError, logger, encryptSecret, decryptSecret, isEncrypted } = require('../../../../shared');

const SENSITIVE_FIELDS = ['key_id', 'key_secret', 'webhook_secret'];

function encryptGatewayPayload(data) {
  const out = { ...data };
  for (const field of SENSITIVE_FIELDS) {
    if (out[field] !== undefined && out[field] !== null && String(out[field]).trim() !== '') {
      out[field] = encryptSecret(String(out[field]).trim());
    }
  }
  return out;
}

function decryptGatewayCredentials(row) {
  const plain = row?.get ? row.get({ plain: true }) : { ...row };
  return {
    key_id: decryptSecret(plain.key_id || ''),
    key_secret: decryptSecret(plain.key_secret || ''),
    webhook_secret: decryptSecret(plain.webhook_secret || ''),
  };
}

/** Admin API: never return raw secrets — only metadata and decrypted key_id for display. */
function toAdminGatewayDto(row) {
  const plain = row?.get ? row.get({ plain: true }) : { ...row };
  const decryptedKeyId = decryptSecret(plain.key_id || '', { soft: true });
  return {
    id: plain.id,
    name: plain.name,
    gateway_name: plain.gateway_name || 'razorpay',
    key_id: decryptedKeyId ?? '••••••••',
    is_active: Number(plain.is_active) === 1 ? 1 : 0,
    created_at: plain.created_at,
    updated_at: plain.updated_at,
    has_key_secret: Boolean(plain.key_secret),
    has_webhook_secret: Boolean(plain.webhook_secret),
    key_id_locked: decryptedKeyId == null && isEncrypted(plain.key_id || ''),
  };
}

async function listPaymentGateways() {
  try {
    const rows = await PaymentGateway.findAll({
      order: [['created_at', 'DESC']],
    });
    return rows.map((row) => {
      try {
        return toAdminGatewayDto(row);
      } catch (err) {
        logger.warn('[paymentGateway] skipping row in list — dto mapping failed', {
          id: row?.id,
          error: err.message,
        });
        return null;
      }
    }).filter(Boolean);
  } catch (err) {
    logger.error('[paymentGateway] listPaymentGateways failed', { error: err.message });
    throw err;
  }
}

async function getPaymentGatewayById(id) {
  try {
    const item = await PaymentGateway.findByPk(id);
    if (!item) throw new AppError('Payment gateway configuration not found', 404);
    return toAdminGatewayDto(item);
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
    const encrypted = encryptGatewayPayload({
      name,
      gateway_name: gateway_name || 'razorpay',
      key_id,
      key_secret,
      webhook_secret: webhook_secret || null,
      is_active: is_active ? 1 : 0,
    });

    const created = await sequelize.transaction(async (t) => {
      if (is_active) {
        await PaymentGateway.update(
          { is_active: 0 },
          { where: { gateway_name: gateway_name || 'razorpay' }, transaction: t }
        );
      }

      return PaymentGateway.create(encrypted, { transaction: t });
    });

    return toAdminGatewayDto(created);
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
    const updates = {
      ...(name !== undefined && { name }),
      ...(gateway_name !== undefined && { gateway_name }),
      ...(key_id !== undefined && { key_id: encryptSecret(String(key_id).trim()) }),
      ...(key_secret !== undefined && { key_secret: encryptSecret(String(key_secret).trim()) }),
      ...(webhook_secret !== undefined && {
        webhook_secret: webhook_secret ? encryptSecret(String(webhook_secret).trim()) : null,
      }),
      ...(is_active !== undefined && { is_active: is_active ? 1 : 0 }),
    };

    const updated = await sequelize.transaction(async (t) => {
      if (is_active && !item.is_active) {
        await PaymentGateway.update(
          { is_active: 0 },
          { where: { gateway_name: item.gateway_name }, transaction: t }
        );
      }

      await item.update(updates, { transaction: t });
      return item.reload({ transaction: t });
    });

    return toAdminGatewayDto(updated);
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
  deletePaymentGateway,
  decryptGatewayCredentials,
};
