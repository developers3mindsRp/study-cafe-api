const axios = require('axios');
const config = require('../config');
const { logger } = require('../../../../shared');

/**
 * Notify affiliate about withdrawal lifecycle (via auth-service SMTP).
 * Non-blocking — logs failures, never throws.
 */
async function notifyWithdrawalEmail({ affiliateId, request, status, remarks }) {
  const { sequelize } = require('../models');
  const { QueryTypes } = require('sequelize');

  const uid = Number(affiliateId);
  if (!Number.isFinite(uid)) return;

  let user;
  try {
    const rows = await sequelize.query(
      'SELECT id, name, email FROM users WHERE id = :id LIMIT 1',
      { replacements: { id: uid }, type: QueryTypes.SELECT }
    );
    user = rows[0];
  } catch (err) {
    logger.warn('[withdrawal-email] user lookup failed', { affiliateId: uid, err: err.message });
    return;
  }

  if (!user?.email) {
    logger.warn('[withdrawal-email] no email for affiliate', { affiliateId: uid, requestId: request?.id });
    return;
  }

  const payload = {
    to: user.email,
    name: user.name || null,
    status,
    requestId: request.id,
    amount: parseFloat(request.amount),
    currency: 'INR',
    remarks: remarks != null ? String(remarks).trim() : request.remarks || null,
  };

  try {
    await axios.post(`${config.authServiceUrl}/internal/send-withdrawal-email`, payload, {
      headers: { 'x-internal-api-key': config.internalApiKey },
      timeout: 15000,
    });
    logger.info('[withdrawal-email] sent', {
      to: user.email,
      status,
      requestId: request.id,
    });
  } catch (err) {
    logger.warn('[withdrawal-email] auth-service call failed', {
      status,
      requestId: request.id,
      err: err?.response?.data?.message || err?.message,
    });
  }
}

module.exports = { notifyWithdrawalEmail };
