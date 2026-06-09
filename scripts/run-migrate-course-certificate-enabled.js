/**
 * Adds courses.certificate_enabled if missing.
 * Usage: node scripts/run-migrate-course-certificate-enabled.js
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

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
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'courses' AND COLUMN_NAME = 'certificate_enabled'`,
    [db],
  );

  if (cols.length) {
    console.log('OK: courses.certificate_enabled already exists.');
    await conn.end();
    return;
  }

  const sql = fs.readFileSync(path.join(__dirname, 'migrate-course-certificate-enabled.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      console.log('OK:', stmt.slice(0, 80));
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME') {
        console.log('SKIP (exists):', stmt.slice(0, 60));
      } else {
        throw err;
      }
    }
  }

  await conn.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
