#!/usr/bin/env node
/**
 * Adds extended SEO / OG columns on `articles` if missing (safe to re-run).
 * Replaces the raw .sql batch runner which fails on ER_DUP_FIELDNAME when some columns already exist.
 *
 * Env (from .env or shell): MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 *   npm run ensure-articles-extended-seo
 */

'use strict';

require('dotenv/config');
const mysql = require('mysql2/promise');

const TABLE = 'articles';

/** [column_name, MySQL type fragment after column name] */
const COLUMNS = [
  ['canonical_url', 'VARCHAR(1000) NULL'],
  ['robots', 'VARCHAR(255) NULL'],
  ['og_title', 'VARCHAR(255) NULL'],
  ['og_description', 'TEXT NULL'],
  ['og_image_url', 'VARCHAR(500) NULL'],
  ['thumbnail_alt', 'VARCHAR(500) NULL'],
  ['thumbnail_link_url', 'VARCHAR(500) NULL'],
  ['thumbnail_caption', 'TEXT NULL'],
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
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'studycafe_db';

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
