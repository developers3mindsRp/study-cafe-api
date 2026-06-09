/**
 * Adds deleted_at columns for soft-delete (trash) if missing.
 * Usage: node scripts/run-soft-delete-migration.js
 */
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const TABLES = ['users', 'orders', 'courses', 'articles'];

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
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND COLUMN_NAME = 'deleted_at' AND TABLE_NAME IN (?)`,
    [db, TABLES]
  );
  const has = new Set(cols.map((r) => r.TABLE_NAME));

  if (TABLES.every((t) => has.has(t))) {
    console.log('OK: deleted_at already exists on all tables.');
    await conn.end();
    return;
  }

  const sql = fs.readFileSync(path.join(__dirname, 'migrate-soft-delete.sql'), 'utf8');
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('--'));

  for (const stmt of statements) {
    try {
      await conn.query(stmt);
      console.log('Applied:', stmt.slice(0, 60).replace(/\s+/g, ' ') + '…');
    } catch (err) {
      if (
        err.code === 'ER_DUP_FIELDNAME' ||
        err.code === 'ER_DUP_KEYNAME' ||
        err.code === 'ER_KEY_COLUMN_DOES_NOT_EXITS'
      ) {
        console.log('Skip:', stmt.slice(0, 50), `(${err.code})`);
      } else {
        throw err;
      }
    }
  }

  // Retry indexes after columns (handles partial runs where index failed before column existed)
  for (const t of TABLES) {
    try {
      await conn.query(`CREATE INDEX idx_${t}_deleted_at ON ${t} (deleted_at)`);
      console.log('Index ok:', t);
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') console.log('Index exists:', t);
      else if (err.code === 'ER_KEY_COLUMN_DOES_NOT_EXITS') {
        console.warn('WARN: missing deleted_at on', t, '— add column manually');
      } else {
        throw err;
      }
    }
  }

  console.log('Soft-delete migration complete. Restart auth, order, course, and platform services.');
  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
