#!/usr/bin/env node
/**
 * Ensures cms_pages table exists in studycafe_db.
 * Use this when the DB was created without running migrate-wp-to-ms (e.g. other migrations).
 *
 * Usage (from studycafe-ms root):
 *   node scripts/ensure-cms-pages-table.js
 */

'use strict';

const path = require('path');
const { Sequelize } = require('sequelize');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../services/platform-service/.env') });
} catch (_) {}
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (_) {}

let mysqlConfig;
try {
  mysqlConfig = require('../services/platform-service/src/config').mysql;
} catch (_) {
  mysqlConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || 'GDZ@p84i-F2X',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
  };
}

const sql = `
  CREATE TABLE IF NOT EXISTS cms_pages (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    slug VARCHAR(100) NOT NULL UNIQUE,
    title VARCHAR(500),
    content LONGTEXT,
    meta JSON,
    created_at DATETIME,
    updated_at DATETIME
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

async function main() {
  const tgt = new Sequelize(mysqlConfig.database, mysqlConfig.user, mysqlConfig.password, {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    dialect: 'mysql',
    logging: false,
  });

  await tgt.authenticate();
  console.log(`Connected to ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);

  await tgt.query(sql.trim(), { raw: true });
  console.log('✅ cms_pages table ensured');

  await tgt.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
