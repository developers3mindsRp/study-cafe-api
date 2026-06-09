#!/usr/bin/env node
/**
 * Adds `expired` to affiliate_history.status enum (for affiliate earnings expiry).
 *
 * Usage (from study-cafe-api root):
 *   node scripts/ensure-affiliate-history-expired-status.js
 */

'use strict';

const { Sequelize } = require('sequelize');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const mysqlConfig = getMysqlConfig();

const sql = `
  ALTER TABLE affiliate_history
  MODIFY COLUMN status ENUM('pending','confirmed','expired') NOT NULL DEFAULT 'confirmed'
`;

async function main() {
  const db = new Sequelize(mysqlConfig.database, mysqlConfig.user, mysqlConfig.password, {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    dialect: 'mysql',
    logging: false,
  });

  await db.authenticate();
  console.log(`Connected to ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);

  const [tables] = await db.query(
    "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'affiliate_history'",
  );
  if (!tables.length) {
    console.log('affiliate_history table not found — run migrate-wp-to-ms first.');
    process.exit(0);
  }

  await db.query(sql.trim(), { raw: true });
  console.log('affiliate_history.status enum updated (expired added).');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
