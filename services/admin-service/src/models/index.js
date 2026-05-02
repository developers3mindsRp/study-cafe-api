const { Sequelize } = require('sequelize');
const config = require('../config');

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
    console.error('[admin-service] payment_links bootstrap:', err.message);
    throw err;
  }
  try {
    await sequelize.query(
      'ALTER TABLE payment_links ADD COLUMN random_boost_accumulator INT UNSIGNED NOT NULL DEFAULT 0 AFTER random_value'
    );
  } catch (err) {
    if (err?.parent?.errno !== 1060 && err?.original?.errno !== 1060) throw err;
  }
}

module.exports = {
  sequelize,
  AdminLog,
  PaymentConfig,
  Coupon,
  PaymentLink,
  connect,
};
