const { Sequelize } = require('sequelize');
const config = require('../config');
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

const Order = require('./Order')(sequelize);
const Payment = require('./Payment')(sequelize);
const OutboxEvent = require('./OutboxEvent')(sequelize);
const Coupon = require('./Coupon')(sequelize);
const WebhookEvent = require('./WebhookEvent')(sequelize);
const CouponUsage = require('./CouponUsage')(sequelize);

Order.associate({ Payment });
Payment.associate({ Order });

async function connect() {
  await sequelize.authenticate();
  await sequelize.sync();
  // Idempotent column add for environments where sync() already ran before
  // this column existed in the model. Safe to run every boot.
  try {
    await sequelize.query(
      "ALTER TABLE orders ADD COLUMN batch_id INT NULL AFTER entity_id"
    );
  } catch (err) {
    // MySQL error 1060 = "Duplicate column name" — column already present.
    if (err?.parent?.errno !== 1060 && err?.original?.errno !== 1060) {
      throw err;
    }
  }
  try {
    await sequelize.query('ALTER TABLE orders ADD COLUMN buyer_gst VARCHAR(32) NULL AFTER buyer_mobile');
  } catch (err) {
    if (err?.parent?.errno !== 1060 && err?.original?.errno !== 1060) {
      throw err;
    }
  }
}

module.exports = {
  sequelize,
  Order,
  Payment,
  OutboxEvent,
  Coupon,
  CouponUsage,
  WebhookEvent,
  connect,
};
