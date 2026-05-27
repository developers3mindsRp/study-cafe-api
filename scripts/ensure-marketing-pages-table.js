#!/usr/bin/env node
/**
 * Ensures marketing_pages exists.
 * Usage from study-cafe-api root: npm run ensure-marketing-pages
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const sqlPath = path.join(
  __dirname,
  '..',
  'services',
  'course-service',
  'scripts',
  'create-marketing-pages-table.sql',
);

async function main() {
  const db = getMysqlConfig();
  const { host, port, user, password, database } = db;

  const sql = fs.readFileSync(sqlPath, 'utf8');
  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  try {
    await conn.query(sql);
    const [rows] = await conn.query("SHOW TABLES LIKE 'marketing_pages'");
    if (!rows.length) {
      throw new Error('Table marketing_pages was not created');
    }
    console.log(`OK: marketing_pages on ${host}:${port}/${database}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('ensure-marketing-pages failed:', err.message);
  process.exit(1);
});
