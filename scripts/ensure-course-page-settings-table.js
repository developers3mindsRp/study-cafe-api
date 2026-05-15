#!/usr/bin/env node
/**
 * Ensures sc_course_page_settings exists (admin Courses → Page Settings).
 * Usage from study-cafe-api root: npm run ensure-course-page-settings
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sqlPath = path.join(
  __dirname,
  '..',
  'services',
  'course-service',
  'scripts',
  'create-course-page-settings-table.sql',
);

async function main() {
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_USER || 'studycafe_user';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'studycafe_db';

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
    const [rows] = await conn.query(
      "SHOW TABLES LIKE 'sc_course_page_settings'",
    );
    if (!rows.length) {
      throw new Error('Table sc_course_page_settings was not created');
    }
    console.log(
      `OK: sc_course_page_settings on ${host}:${port}/${database}`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('ensure-course-page-settings failed:', err.message);
  process.exit(1);
});
