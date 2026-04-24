#!/usr/bin/env node
/**
 * Ensures newsletter tables exist in studycafe_db:
 *   - newsletter_subscribers
 *   - newsletter_templates
 *
 * Usage (from studycafe-ms root):
 *   node scripts/ensure-newsletter-tables.js
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

const subscribersSql = `
  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    is_verified TINYINT(1) NOT NULL DEFAULT 0,
    unsubscribe_token VARCHAR(64) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_newsletter_subscribers_email (email),
    UNIQUE KEY uniq_newsletter_subscribers_unsub_token (unsubscribe_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const templatesSql = `
  CREATE TABLE IF NOT EXISTS newsletter_templates (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    html_content LONGTEXT NOT NULL,
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

  await tgt.query(subscribersSql.trim(), { raw: true });
  console.log('✅ newsletter_subscribers table ensured');

  await tgt.query(templatesSql.trim(), { raw: true });
  console.log('✅ newsletter_templates table ensured');

  await tgt.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
