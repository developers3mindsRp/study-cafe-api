#!/usr/bin/env node
/**
 * Adds articles.type_of_tax if missing (notification tax type field).
 *
 * Run from the study-cafe-api root:
 *   npm run migrate:article-type-of-tax
 *
 * Requires: a valid .env in the repo root (same DB credentials used by the services).
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Sequelize } = require('sequelize');

const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_USER,
  DB_PASSWORD,
  DB_NAME,
  MYSQL_HOST,
  MYSQL_PORT,
  MYSQL_USER,
  MYSQL_PASSWORD,
  MYSQL_DATABASE,
} = process.env;

const host = MYSQL_HOST || DB_HOST;
const port = MYSQL_PORT || DB_PORT;
const user = MYSQL_USER || DB_USER;
const password = MYSQL_PASSWORD || DB_PASSWORD;
const database = MYSQL_DATABASE || DB_NAME;

if (!user || !database) {
  console.error(
    '\n❌  Missing DB credentials in .env\n' +
    '    Set DB_USER + DB_NAME  or  MYSQL_USER + MYSQL_DATABASE\n'
  );
  process.exit(1);
}

const sequelize = new Sequelize(database, user, password, {
  host,
  port: Number(port),
  dialect: 'mysql',
  logging: false,
});

async function columnExists(tableName, colName) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = :table
       AND COLUMN_NAME  = :col`,
    { replacements: { table: tableName, col: colName }, raw: true }
  );
  return Number(rows[0].cnt) > 0;
}

async function main() {
  console.log('\n🔍  Connecting to DB:', `${user}@${host}:${port}/${database}\n`);

  try {
    await sequelize.authenticate();
    console.log('✅  Connected.\n');
  } catch (err) {
    console.error('❌  Cannot connect to DB:', err.message);
    process.exit(1);
  }

  const TABLE = 'articles';
  const col = 'type_of_tax';
  const ddl =
    "ALTER TABLE articles ADD COLUMN type_of_tax VARCHAR(100) NULL COMMENT 'Notification tax type (GST, Income Tax, etc.)' AFTER noti_date";

  const exists = await columnExists(TABLE, col);
  if (exists) {
    console.log(`  ✅  \`${TABLE}.${col}\`  — EXISTS (no changes needed)\n`);
  } else {
    console.log(`  ❌  \`${TABLE}.${col}\`  — MISSING → adding now…`);
    try {
      await sequelize.query(ddl, { raw: true });
      console.log(`  ✅  \`${TABLE}.${col}\`  — ADDED successfully\n`);
    } catch (err) {
      if (err?.parent?.errno === 1060 || err?.original?.errno === 1060) {
        console.log(`  ✅  \`${TABLE}.${col}\`  — already present (concurrent add)\n`);
      } else {
        console.error(`  ❗  Failed to add \`${TABLE}.${col}\`:`, err.message);
        process.exit(1);
      }
    }
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
