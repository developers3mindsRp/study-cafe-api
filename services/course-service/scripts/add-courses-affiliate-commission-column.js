const { sequelize } = require('../src/models');

async function run() {
  const [results] = await sequelize.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'affiliate_commission'
  `);
  if (results.length > 0) {
    console.log('Column affiliate_commission already exists on courses.');
    await sequelize.close();
    process.exit(0);
    return;
  }
  await sequelize.query(`
    ALTER TABLE courses
    ADD COLUMN affiliate_commission DECIMAL(10,2) NOT NULL DEFAULT 0
    AFTER end_date
  `);
  console.log('Added column affiliate_commission to courses table.');
  await sequelize.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
