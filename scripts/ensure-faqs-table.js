#!/usr/bin/env node
/**
 * Ensures faqs table exists in studycafe_db.
 * Use when the DB was created without running migrate-wp-to-ms or faqs was missing.
 *
 * Usage (from studycafe-ms root):
 *   node scripts/ensure-faqs-table.js
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
  CREATE TABLE IF NOT EXISTS faqs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
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
  console.log('✅ faqs table ensured');

  await tgt.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
