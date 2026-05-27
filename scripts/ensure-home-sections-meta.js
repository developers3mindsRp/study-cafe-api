#!/usr/bin/env node
/**
 * Ensures home_sections has a meta column (JSON) for hero/features/stats data.
 * Run when you see "Unknown column 'meta' in 'field list'" from platform-service.
 *
 * Usage (from studycafe-ms root):
 *   node scripts/ensure-home-sections-meta.js
 */

'use strict';

const { Sequelize } = require('sequelize');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const mysqlConfig = getMysqlConfig();

async function main() {
  const db = new Sequelize(mysqlConfig.database, mysqlConfig.user, mysqlConfig.password, {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    dialect: 'mysql',
    logging: false,
  });

  await db.authenticate();
  console.log(`Connected to ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);

  try {
    await db.query(
      'ALTER TABLE home_sections ADD COLUMN meta JSON NULL AFTER content',
      { raw: true }
    );
    console.log('✅ home_sections.meta column added');
  } catch (e) {
    if (e.original && e.original.code === 'ER_DUP_FIELDNAME') {
      console.log('✅ home_sections.meta column already exists');
    } else if (e.original && e.original.code === 'ER_NO_SUCH_TABLE') {
      console.log('⏭️  home_sections table does not exist in this DB; run migrate:wp-to-ms or ensure you are connected to studycafe_db (e.g. MYSQL_PORT=3306 MYSQL_DATABASE=studycafe_db).');
      process.exit(0);
    } else {
      throw e;
    }
  }

  await db.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
