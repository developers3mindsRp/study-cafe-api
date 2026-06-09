#!/usr/bin/env node
/**
 * check-gst-column.js
 * -------------------
 * Checks whether the `gst` (and `account_status`) columns exist in the `users` table.
 * If they are missing, the script adds them automatically.
 *
 * Run from the study-cafe-api root:
 *   npm run check:gst
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

// Support both naming conventions used across services
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

/** Returns true if `colName` exists in `tableName` */
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

  const TABLE = 'users';
  const checks = [
    {
      col: 'gst',
      ddl: 'ALTER TABLE users ADD COLUMN gst VARCHAR(100) NULL AFTER youtube',
      label: 'GST number (user profile)',
    },
    {
      col: 'account_status',
      ddl: 'ALTER TABLE users ADD COLUMN account_status VARCHAR(50) NULL AFTER gst',
      label: 'Account status (legacy WP field)',
    },
  ];

  let allOk = true;

  for (const { col, ddl, label } of checks) {
    const exists = await columnExists(TABLE, col);
    if (exists) {
      console.log(`  ✅  \`${TABLE}.${col}\`  — EXISTS   (${label})`);
    } else {
      allOk = false;
      console.log(`  ❌  \`${TABLE}.${col}\`  — MISSING  (${label}) → adding now…`);
      try {
        await sequelize.query(ddl, { raw: true });
        console.log(`  ✅  \`${TABLE}.${col}\`  — ADDED successfully`);
      } catch (err) {
        if (err?.parent?.errno === 1060 || err?.original?.errno === 1060) {
          // Race condition — already added by a concurrent process
          console.log(`  ✅  \`${TABLE}.${col}\`  — already present (concurrent add)`);
        } else {
          console.error(`  ❗  Failed to add \`${TABLE}.${col}\`:`, err.message);
        }
      }
    }
  }

  console.log('\n--- GST column check complete ---');
  if (!allOk) {
    console.log('ℹ️   One or more columns were missing and have been added.');
    console.log('    Old users migrated from WordPress will have their GST values');
    console.log('    populated once you run:  npm run migrate:wp-to-ms\n');
  } else {
    console.log('🎉  All columns are present. No changes needed.\n');
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
