#!/usr/bin/env node
/**
 * Payment links that fulfil themselves.
 *
 * Adds the columns that let a payment link say *what it sells* (`payment_links`)
 * and let an order remember what it was sold (`orders.fulfilment`), so a paid
 * checkout can grant the course/membership automatically instead of waiting for
 * an admin to assign it by hand.
 *
 * Safe to re-run — every column is checked before it is added, and existing rows
 * default to product_type='custom', which is the pre-upgrade behaviour (collect
 * money, grant nothing).
 *
 * Env (from .env or shell): MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 *   npm run migrate:payment-link-products
 */

'use strict';

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

/** table -> [[column_name, MySQL type fragment after column name], ...] */
const COLUMNS = {
  payment_links: [
    ['product_type', "VARCHAR(20) NOT NULL DEFAULT 'custom' COMMENT 'custom | course | membership'"],
    ['product_id', "VARCHAR(64) NULL COMMENT 'course id or membership plan id, per product_type'"],
    ['batch_id', "BIGINT UNSIGNED NULL COMMENT 'course links only; NULL = auto-select at purchase'"],
    ['auto_enroll', 'TINYINT(1) NOT NULL DEFAULT 1'],
  ],
  orders: [
    [
      'fulfilment',
      "JSON NULL COMMENT 'what this order must grant, snapshotted at create time: {product_type, product_id, batch_id}'",
    ],
  ],
};

/** Lookups for "which links sell course X" reporting; skipped when already present. */
const INDEXES = [
  ['payment_links', 'idx_payment_links_product', '(product_type, product_id)'],
];

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
