#!/usr/bin/env node
'use strict';

const { getSequelize } = require('../shared/apiRequestLogger/db');

async function run() {
  const sequelize = getSequelize();
  const [tables] = await sequelize.query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_request_logs'
  `);

  if (tables.length > 0) {
    console.log('Table api_request_logs already exists.');
    await sequelize.close();
    return;
  }

  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, 'create-api-request-logs-table.sql'), 'utf8');
  await sequelize.query(sql);
  console.log('Created table api_request_logs.');
  await sequelize.close();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
