const { sequelize } = require('../src/models');

async function run() {
  const [results] = await sequelize.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_verified_at'
  `);
  if (results.length === 0) {
    await sequelize.query(`
      ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL
    `);
    console.log('Added column email_verified_at to users.');
    await sequelize.query(`
      UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL
    `);
    console.log('Backfilled email_verified_at from created_at for existing accounts.');
  } else {
    console.log('Column email_verified_at already exists — skipping backfill.');
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
