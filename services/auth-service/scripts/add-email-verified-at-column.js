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
      UPDATE users
      SET email_verified_at = COALESCE(created_at, NOW())
      WHERE email_verified_at IS NULL AND wp_user_id IS NOT NULL
    `);
    console.log('Backfilled email_verified_at for migrated (wp_user_id) accounts.');
  } else {
    const [, meta] = await sequelize.query(`
      UPDATE users
      SET email_verified_at = COALESCE(created_at, NOW())
      WHERE email_verified_at IS NULL AND wp_user_id IS NOT NULL
    `);
    console.log(
      `Column email_verified_at already exists — backfilled ${meta?.affectedRows ?? 0} migrated account(s).`
    );
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
