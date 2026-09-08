#!/usr/bin/env node
/**
 * Admin course deallotment, recorded rather than inferred.
 *
 * Removing a course from a user used to delete the `user_courses` row outright. That
 * leaves no trace, and a missing row already means something else entirely: the access
 * grant is written asynchronously by the order-service outbox worker, so a freshly-paid
 * order legitimately has no row yet (and ~224 older paid orders have none at all). A
 * deleted row and a never-written row are indistinguishable, so nothing downstream could
 * tell "an admin removed this" from "the grant hasn't landed".
 *
 * `revoked_at` makes the removal explicit: deallotment keeps the row and stamps the
 * column, so a NULL/missing row keeps meaning exactly what it means today and only a
 * stamped row hides the course from the learner.
 *
 * Safe to re-run — the column is checked before it is added, and every existing row
 * defaults to NULL, which is the pre-upgrade behaviour (granted, not revoked).
 *
 * Env (from .env or shell): MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 *   npm run migrate:user-courses-revoked-at
 */

'use strict';

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

/** table -> [[column_name, MySQL type fragment after column name], ...] */
const COLUMNS = {
  user_courses: [
    [
      'revoked_at',
      "DATETIME NULL DEFAULT NULL COMMENT 'set when an admin deallots the course; NULL = active grant'",
    ],
  ],
};

/** Read paths filter on (user_id, revoked_at); skipped when already present. */
const INDEXES = [['user_courses', 'idx_user_courses_revoked_at', '(user_id, revoked_at)']];

async function columnExists(conn, table, columnName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, columnName],
  );
  return Number(rows[0]?.cnt) > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName],
  );
  return Number(rows[0]?.cnt) > 0;
}

async function main() {
  const { host, port, user, password, database } = getMysqlConfig();

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

    for (const [table, cols] of Object.entries(COLUMNS)) {
      for (const [name, ddl] of cols) {
        if (await columnExists(conn, table, name)) {
          console.log(`skip (exists): ${table}.${name}`);
          skipped += 1;
          continue;
        }
        await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${ddl}`);
        console.log(`added: ${table}.${name}`);
        added += 1;
      }
    }

    for (const [table, indexName, definition] of INDEXES) {
      if (await indexExists(conn, table, indexName)) {
        console.log(`skip (exists): ${table}.${indexName}`);
        skipped += 1;
        continue;
      }
      await conn.query(`ALTER TABLE \`${table}\` ADD KEY \`${indexName}\` ${definition}`);
      console.log(`added: ${table}.${indexName}`);
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
