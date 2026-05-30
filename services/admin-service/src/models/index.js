const { Sequelize } = require('sequelize');
const config = require('../config');
const { logger } = require('../../../../shared');

const sequelize = new Sequelize(
  config.mysql.database,
  config.mysql.user,
  config.mysql.password,
  {
    host: config.mysql.host,
    port: config.mysql.port,
    dialect: 'mysql',
    logging: false,
    pool: {
      max: config.mysql.connectionLimit || 10,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: { underscored: true },
  }
);

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
