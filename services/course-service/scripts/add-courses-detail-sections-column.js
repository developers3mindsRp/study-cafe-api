const { sequelize } = require('../src/models');

async function run() {
  const [results] = await sequelize.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'detail_sections'
  `);
  if (results.length > 0) {
    console.log('Column detail_sections already exists on courses.');
    await sequelize.close();
    process.exit(0);
    return;
  }
  await sequelize.query(`
    ALTER TABLE courses
    ADD COLUMN detail_sections LONGTEXT NULL
    AFTER validity
  `);
  console.log('Added column detail_sections to courses table.');
  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
