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
