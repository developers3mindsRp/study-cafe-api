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
    define: {
      underscored: true,
      timestamps: false,
    },
  }
);

const File = require('./File')(sequelize);
const FileCat = require('./FileCat')(sequelize);
const FileCategory = require('./FileCategory')(sequelize);

File.associate({ FileCat, FileCategory });
FileCat.associate({ File, FileCategory });

const models = { File, FileCat, FileCategory };

async function connect() {
  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error('Sequelize auth failed:', err.message);
    throw err;
  }
}

module.exports = {
  sequelize,
  ...models,
  connect,
};
