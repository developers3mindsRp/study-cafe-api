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

const Course = require('./Course')(sequelize);
const Batch = require('./Batch')(sequelize);
const Session = require('./Session')(sequelize);
const Recording = require('./Recording')(sequelize);
const Material = require('./Material')(sequelize);
const CourseCat = require('./CourseCat')(sequelize);
const CourseCategory = require('./CourseCategory')(sequelize);
const CourseAuthor = require('./CourseAuthor')(sequelize);
const Enrollment = require('./Enrollment')(sequelize);
const CoursePageSetting = require('./CoursePageSetting')(sequelize);
const BatchEnrollment = require('./BatchEnrollment')(sequelize);
const AffiliateHistory = require('./AffiliateHistory')(sequelize);
const WithdrawalRequest = require('./WithdrawalRequest')(sequelize);
const AffiliateBalance = require('./AffiliateBalance')(sequelize);
const UserCourseProgress = require('./UserCourseProgress')(sequelize);
const UserCourse = require('./UserCourse')(sequelize);
const CourseReview = require('./CourseReview')(sequelize);

const models = { 
  Course, 
  Batch, 
  Session, 
  Recording, 
  Material, 
  CourseCat, 
  CourseCategory, 
  CourseAuthor, 
  Enrollment, 
  CoursePageSetting, 
  BatchEnrollment,
  AffiliateHistory,
  WithdrawalRequest,
  AffiliateBalance,
  UserCourseProgress,
  UserCourse,
  CourseReview,
};

// Register associations
Object.keys(models).forEach((modelName) => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Extra specific associations
Batch.hasMany(BatchEnrollment, { foreignKey: 'batch_id', as: 'enrollments' });

const { ensureCoursePageSettingsTable } = require('../db/ensureCoursePageSettingsTable');

async function connect() {
  try {
    await sequelize.authenticate();
    await ensureCoursePageSettingsTable(sequelize);
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
