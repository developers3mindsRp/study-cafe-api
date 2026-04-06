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
const PromoCode = require('./PromoCode')(sequelize);

async function connect() {
  await sequelize.authenticate();
}

module.exports = {
  sequelize,
  AdminLog,
  PaymentConfig,
  PromoCode,
  connect,
};
