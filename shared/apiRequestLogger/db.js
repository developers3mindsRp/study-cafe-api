'use strict';

const { Sequelize } = require('sequelize');
const { mysqlConfig } = require('../env');
const createApiRequestLogModel = require('./ApiRequestLog');

let sequelize;
let ApiRequestLog;

function getSequelize() {
  if (sequelize) return sequelize;

  const db = mysqlConfig({ connectionLimit: 2 });
  sequelize = new Sequelize(db.database, db.user, db.password, {
    host: db.host,
    port: db.port,
    dialect: 'mysql',
    logging: false,
    timezone: '+05:30',
    dialectOptions: { timezone: '+05:30' },
    pool: {
      max: db.connectionLimit || 2,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    define: { underscored: true },
  });

  ApiRequestLog = createApiRequestLogModel(sequelize);
  return sequelize;
}

function getApiRequestLogModel() {
  getSequelize();
  return ApiRequestLog;
}

module.exports = {
  getSequelize,
  getApiRequestLogModel,
};
