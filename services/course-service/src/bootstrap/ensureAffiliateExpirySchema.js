const { logger } = require('../../../../shared');

/**
 * Ensures affiliate_history.status supports `expired` (idempotent on startup).
 */
async function ensureAffiliateExpirySchema(sequelize) {
  try {
    const [tables] = await sequelize.query(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'affiliate_history'",
    );
    if (!tables.length) return;

    const [cols] = await sequelize.query(
      `SELECT COLUMN_TYPE AS column_type FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'affiliate_history' AND COLUMN_NAME = 'status'
       LIMIT 1`,
    );
    const columnType = String(cols[0]?.column_type || cols[0]?.COLUMN_TYPE || '');
    if (/expired/i.test(columnType)) return;

    await sequelize.query(
      `ALTER TABLE affiliate_history
       MODIFY COLUMN status ENUM('pending','confirmed','expired') NOT NULL DEFAULT 'confirmed'`,
    );
    logger.info('[course-service] affiliate_history.status enum updated (added expired)');
  } catch (err) {
    logger.warn('[course-service] Could not ensure affiliate_history expired status', {
      error: err?.message,
    });
  }
}

module.exports = { ensureAffiliateExpirySchema };
