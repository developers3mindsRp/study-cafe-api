const { Sequelize } = require('sequelize');
const config = require('../config');
const { logger, encryptSecret, isEncrypted } = require('../../../../shared');
const { attachQueryCollector } = require('../../../../shared/apiRequestLogger');

const sequelize = new Sequelize(
  config.mysql.database,
  config.mysql.user,
  config.mysql.password,
  {
    host: config.mysql.host,
    port: config.mysql.port,
    dialect: 'mysql',
    logging: false,
    timezone: '+05:30',
    dialectOptions: { timezone: '+05:30' },
    pool: {
      max: config.mysql.connectionLimit || 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: { underscored: true },
  }
);

attachQueryCollector(sequelize);

const AdminLog = require('./AdminLog')(sequelize);
const PaymentConfig = require('./PaymentConfig')(sequelize);
const Coupon = require('./PromoCode')(sequelize);
const PaymentLink = require('./PaymentLink')(sequelize);
const PaymentGateway = require('./PaymentGateway')(sequelize);

async function connect() {
  await sequelize.authenticate();
  try {
    await sequelize.query(`
CREATE TABLE IF NOT EXISTS payment_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description LONGTEXT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  sale_price DECIMAL(12, 2) NOT NULL,
  expiry DATETIME NOT NULL,
  total_seats INT UNSIGNED NOT NULL DEFAULT 0,
  seats_booked INT UNSIGNED NOT NULL DEFAULT 0,
  random_value VARCHAR(32) NULL,
  random_boost_accumulator INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_payment_links_slug (slug),
  KEY idx_payment_links_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    logger.error('[admin-service] payment_links bootstrap failed', { error: err.message });
    throw err;
  }
  try {
    await sequelize.query(
      'ALTER TABLE payment_links ADD COLUMN random_boost_accumulator INT UNSIGNED NOT NULL DEFAULT 0 AFTER random_value'
    );
  } catch (err) {
    if (err?.parent?.errno !== 1060 && err?.original?.errno !== 1060) throw err;
  }

  try {
    await sequelize.query(`
CREATE TABLE IF NOT EXISTS payment_gateways (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  gateway_name VARCHAR(50) NOT NULL DEFAULT 'razorpay',
  key_id VARCHAR(255) NOT NULL,
  key_secret VARCHAR(255) NOT NULL,
  webhook_secret VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_payment_gateways_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  } catch (err) {
    logger.error('[admin-service] payment_gateways bootstrap failed', { error: err.message });
    throw err;
  }

  const widenSecretColumn = async (table, column) => {
    try {
      await sequelize.query(
        `ALTER TABLE ${table} MODIFY COLUMN ${column} VARCHAR(512) ${column === 'webhook_secret' ? 'NULL' : 'NOT NULL'}`
      );
    } catch (err) {
      if (err?.parent?.errno !== 1060 && err?.original?.errno !== 1060) {
        logger.warn(`[admin-service] widen ${table}.${column} skipped`, { error: err.message });
      }
    }
  };

  await widenSecretColumn('payment_gateways', 'key_id');
  await widenSecretColumn('payment_gateways', 'key_secret');
  try {
    await sequelize.query('ALTER TABLE payment_gateways MODIFY COLUMN webhook_secret VARCHAR(512) NULL');
  } catch (err) {
    logger.warn('[admin-service] widen payment_gateways.webhook_secret skipped', { error: err.message });
  }

  try {
    await sequelize.query('ALTER TABLE payment_config MODIFY COLUMN razorpay_key_id VARCHAR(512) NULL');
    await sequelize.query('ALTER TABLE payment_config MODIFY COLUMN razorpay_key_secret VARCHAR(512) NULL');
  } catch (err) {
    logger.warn('[admin-service] widen payment_config columns skipped', { error: err.message });
  }

  await migratePlaintextPaymentSecrets();
}

async function migratePlaintextPaymentSecrets() {
  try {
    const gateways = await PaymentGateway.findAll();
    for (const row of gateways) {
      const updates = {};
      for (const field of ['key_id', 'key_secret', 'webhook_secret']) {
        const value = row[field];
        if (value && !isEncrypted(value)) {
          updates[field] = encryptSecret(value);
        }
      }
      if (Object.keys(updates).length > 0) {
        await row.update(updates);
      }
    }

    const legacy = await PaymentConfig.findByPk(1);
    if (legacy) {
      const updates = {};
      if (legacy.razorpay_key_id && !isEncrypted(legacy.razorpay_key_id)) {
        updates.razorpay_key_id = encryptSecret(legacy.razorpay_key_id);
      }
      if (legacy.razorpay_key_secret && !isEncrypted(legacy.razorpay_key_secret)) {
        updates.razorpay_key_secret = encryptSecret(legacy.razorpay_key_secret);
      }
      if (Object.keys(updates).length > 0) {
        await legacy.update(updates);
      }
    }
  } catch (err) {
    logger.error('[admin-service] payment secret encryption migration failed', { error: err.message });
  }
}

module.exports = {
  sequelize,
  AdminLog,
  PaymentConfig,
  Coupon,
  PaymentLink,
  PaymentGateway,
  connect,
};
