#!/usr/bin/env node
/**
 * Ensures premium_plans has is_lifetime and plan_course_categories table exists.
 * Uses platform-service config so it runs against the same DB the app uses.
 *
 * Usage (from studycafe-ms root):
 *   node scripts/ensure-premium-plans-schema.js
 */

'use strict';

const { Sequelize } = require('sequelize');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const mysqlConfig = getMysqlConfig();

const TGT_CONFIG = {
  host: mysqlConfig.host,
  port: mysqlConfig.port,
  user: mysqlConfig.user,
  password: mysqlConfig.password,
  database: mysqlConfig.database,
};

async function main() {
  const tgt = new Sequelize(TGT_CONFIG.database, TGT_CONFIG.user, TGT_CONFIG.password, {
    host: TGT_CONFIG.host,
    port: TGT_CONFIG.port,
    dialect: 'mysql',
    logging: false,
  });

  await tgt.authenticate();
  console.log(`Connected to ${TGT_CONFIG.host}:${TGT_CONFIG.port}/${TGT_CONFIG.database}\n`);

  const alters = [
    'ALTER TABLE premium_plans ADD COLUMN is_lifetime TINYINT(1) NOT NULL DEFAULT 0 AFTER duration_days',
  ];
  for (const sql of alters) {
    try {
      await tgt.query(sql, { raw: true });
      console.log('✅ Added column is_lifetime to premium_plans');
    } catch (e) {
      if (e.original && e.original.code === 'ER_DUP_FIELDNAME') {
        console.log('⏭️  Column is_lifetime already exists');
      } else throw e;
    }
  }

  const createTable = `
    CREATE TABLE IF NOT EXISTS plan_course_categories (
      plan_id INT NOT NULL,
      course_cat_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (plan_id, course_cat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;
  await tgt.query(createTable.trim(), { raw: true });
  console.log('✅ plan_course_categories table ensured');

  await tgt.close();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
