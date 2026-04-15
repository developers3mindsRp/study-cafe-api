const { sequelize } = require('../src/models');

async function run() {
  const [results] = await sequelize.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'bio'
  `);
  if (results.length > 0) {
    console.log('Column bio already exists on users.');
    process.exit(0);
    return;
  }
  await sequelize.query(`
    ALTER TABLE users ADD COLUMN bio TEXT NULL
  `);
  console.log('Added column bio to users table.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
