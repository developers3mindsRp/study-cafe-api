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

const Role = require('./Role')(sequelize);
const User = require('./User')(sequelize);
const UserCourse = require('./UserCourse')(sequelize);
const UserMembership = require('./UserMembership')(sequelize);

Role.associate({ User });
User.associate({ Role, UserCourse, UserMembership });

async function connect() {
  await sequelize.authenticate();
}

module.exports = {
  sequelize,
  Role,
  User,
  UserCourse,
  UserMembership,
  connect,
};
