#!/usr/bin/env node
/**
 * drop-banners-table.js
 * ---------------------
 * Drops the retired `banners` table (Popup Banners CMS feature removed).
 *
 * Run from the study-cafe-api root:
 *   npm run migrate:drop-banners
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

async function tableExists(tableName) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = :table`,
    { replacements: { table: tableName }, raw: true }
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

  const TABLE = 'banners';

  if (!(await tableExists(TABLE))) {
    console.log(`  ✅  \`${TABLE}\` table does not exist — nothing to do.\n`);
    await sequelize.close();
    return;
  }

  try {
    await sequelize.query(`DROP TABLE \`${TABLE}\``);
    console.log(`  ✅  Dropped \`${TABLE}\` table.\n`);
  } catch (err) {
    console.error(`  ❗  Failed to drop \`${TABLE}\`:`, err.message);
    process.exit(1);
  }

  await sequelize.close();
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
