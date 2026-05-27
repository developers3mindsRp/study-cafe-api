#!/usr/bin/env node
/**
 * Adds SEO / meta / OG columns on `courses` if missing (safe to re-run).
 *
 * Env: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 *   npm run ensure-courses-seo
 */

'use strict';

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const TABLE = 'courses';

/** [column_name, MySQL type fragment after column name] */
const COLUMNS = [
  ['meta_title', 'VARCHAR(500) NULL'],
  ['meta_description', 'TEXT NULL'],
  ['meta_keywords', 'VARCHAR(500) NULL'],
  ['canonical_url', 'VARCHAR(1000) NULL'],
  ['robots', 'VARCHAR(255) NULL'],
  ['og_title', 'VARCHAR(255) NULL'],
  ['og_description', 'TEXT NULL'],
  ['og_image_url', 'VARCHAR(500) NULL'],
];

async function columnExists(conn, columnName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [TABLE, columnName],
  );
  return Number(rows[0]?.cnt) > 0;
}

async function main() {
  const db = getMysqlConfig();
  const { host, port, user, password, database } = db;

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: false,
  });

  try {
    let added = 0;
    let skipped = 0;
    for (const [name, ddl] of COLUMNS) {
      if (await columnExists(conn, name)) {
        console.log(`skip (exists): ${TABLE}.${name}`);
        skipped += 1;
        continue;
      }
      await conn.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`${name}\` ${ddl}`);
      console.log(`added: ${TABLE}.${name}`);
      added += 1;
    }
    console.log(`Done. Added ${added}, skipped ${skipped}.`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
