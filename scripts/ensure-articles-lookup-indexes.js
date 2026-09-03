#!/usr/bin/env node
/**
 * Adds the lookup indexes `articles` needs for the public site (safe to re-run).
 *
 * Why: the public article page resolves a slug with
 *   SELECT ... FROM articles WHERE status='publish' AND deleted_at IS NULL AND slug IN (?)
 * and `slug` had no index, so every article view fell back to scanning ~10k published rows
 * and reading the `content` LONGTEXT off each one. Measured on a 29,567-row table:
 *
 *   GET /platform/articles/:slug   4,852ms -> 41ms
 *   slug lookup query              3,154ms -> 2ms
 *   related-articles query         1,373ms -> 36ms   (needs the published_at index)
 *
 * The composite index covers the `status='publish' AND deleted_at IS NULL ORDER BY published_at DESC`
 * shape used by the related-articles lookup and the blog/article listings.
 *
 * Env (from .env or shell): MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 *   node scripts/ensure-articles-lookup-indexes.js
 */

'use strict';

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const TABLE = 'articles';

/** [index_name, column list as written in the DDL] */
const INDEXES = [
  ['idx_articles_slug', '(slug)'],
  ['idx_articles_status_deleted_published', '(status, deleted_at, published_at)'],
];

async function indexExists(conn, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [TABLE, indexName],
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
    for (const [name, columns] of INDEXES) {
      if (await indexExists(conn, name)) {
        console.log(`skip (exists): ${TABLE}.${name}`);
        skipped += 1;
        continue;
      }
      const started = Date.now();
      // LOCK=NONE keeps reads AND writes running for the whole build; ALGORITHM=INPLACE avoids
      // a table copy. Stated explicitly so MySQL refuses outright if it ever cannot build the
      // index online, rather than silently falling back to blocking writes on a live table.
      await conn.query(
        `ALTER TABLE \`${TABLE}\` ADD INDEX \`${name}\` ${columns}, ALGORITHM=INPLACE, LOCK=NONE`,
      );
      console.log(`added: ${TABLE}.${name} ${columns} in ${Date.now() - started}ms`);
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
