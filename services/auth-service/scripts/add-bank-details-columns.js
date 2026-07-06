const { sequelize } = require('../src/models');

const COLUMNS = [
  {
    name: 'bank_account_holder_name',
    ddl: 'ADD COLUMN bank_account_holder_name VARCHAR(200) NULL AFTER referred_at',
  },
  {
    name: 'bank_account_number',
    ddl: 'ADD COLUMN bank_account_number VARCHAR(34) NULL AFTER bank_account_holder_name',
  },
  {
    name: 'bank_ifsc',
    ddl: 'ADD COLUMN bank_ifsc VARCHAR(11) NULL AFTER bank_account_number',
  },
  {
    name: 'bank_name',
    ddl: 'ADD COLUMN bank_name VARCHAR(200) NULL AFTER bank_ifsc',
  },
  {
    name: 'bank_branch',
    ddl: 'ADD COLUMN bank_branch VARCHAR(200) NULL AFTER bank_name',
  },
  {
    name: 'bank_details_updated_at',
    ddl: 'ADD COLUMN bank_details_updated_at DATETIME NULL AFTER bank_branch',
  },
];

async function columnExists(name) {
  const [rows] = await sequelize.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = :name
  `, { replacements: { name } });
  return rows.length > 0;
}

async function run() {
  for (const col of COLUMNS) {
    if (await columnExists(col.name)) {
      console.log(`Column ${col.name} already exists on users.`);
      continue;
    }
    await sequelize.query(`ALTER TABLE users ${col.ddl}`);
    console.log(`Added column ${col.name} to users table.`);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
