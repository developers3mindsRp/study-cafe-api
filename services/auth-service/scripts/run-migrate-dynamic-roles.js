/**
 * Applies migrate-dynamic-roles.sql if columns are missing.
 * Usage: node scripts/run-migrate-dynamic-roles.js
 */
const path = require('path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const db = process.env.MYSQL_DATABASE;
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: db,
  });

  const [cols] = await conn.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'permissions'`,
    [db]
  );

  if (cols.length > 0) {
    console.log('OK: roles.permissions column already exists. Restart auth-service if Roles page still shows 503.');
    await conn.end();
    return;
  }

  console.log('Applying dynamic roles migration...');
  await conn.query('ALTER TABLE roles ADD COLUMN description VARCHAR(255) NULL AFTER name');
  await conn.query('ALTER TABLE roles ADD COLUMN permissions JSON NULL AFTER description');
  await conn.query('ALTER TABLE roles ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER permissions');
  await conn.query(
    'ALTER TABLE roles ADD COLUMN is_admin_panel TINYINT(1) NOT NULL DEFAULT 0 AFTER is_system'
  );
  await conn.query("UPDATE roles SET is_system = 1, is_admin_panel = 0 WHERE name = 'user'");
  await conn.query(
    "UPDATE roles SET is_system = 1, is_admin_panel = 1 WHERE name IN ('super_admin', 'admin', 'editor', 'viewer', 'editor_articles', 'custom')"
  );
  await conn.query(
    "UPDATE roles SET is_admin_panel = 1 WHERE is_system = 0 AND name NOT IN ('user')"
  );
  console.log('Migration applied successfully.');
  await conn.end();

  // Merge any duplicate role names left from legacy bootstrap (INSERT IGNORE without UNIQUE).
  require('child_process').execSync('node scripts/dedupe-roles.js', {
    cwd: __dirname,
    stdio: 'inherit',
  });
  console.log('Restart auth-service (npm run dev:auth).');
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
