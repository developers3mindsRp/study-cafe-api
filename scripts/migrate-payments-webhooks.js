#!/usr/bin/env node

/**
 * Migration: payments table alterations + webhook_events table creation.
 *
 * Run: node scripts/migrate-payments-webhooks.js
 *
 * Safe to re-run — each step checks if the change already exists.
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_CONFIG = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER || 'studycafe_user',
  password: process.env.MYSQL_PASSWORD || 'GDZ@p84i-F2X',
  database: process.env.MYSQL_DATABASE || 'studycafe_db',
};

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [DB_CONFIG.database, table, column]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = ? AND table_name = ?`,
    [DB_CONFIG.database, table]
  );
  return rows.length > 0;
}

async function run() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log(`Connected to ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);

  // 1. payments: make razorpay_signature nullable
  console.log('\n--- payments table ---');
  const [cols] = await conn.query(
    `SELECT IS_NULLABLE FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'payments' AND column_name = 'razorpay_signature'`,
    [DB_CONFIG.database]
  );
  if (cols.length && cols[0].IS_NULLABLE === 'NO') {
    await conn.query(`ALTER TABLE payments MODIFY razorpay_signature VARCHAR(255) DEFAULT NULL`);
    console.log('  ✓ razorpay_signature → nullable');
  } else {
    console.log('  · razorpay_signature already nullable (or missing)');
  }

  // 2. payments: add source column
  if (!(await columnExists(conn, 'payments', 'source'))) {
    await conn.query(`ALTER TABLE payments ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'checkout'`);
    console.log('  ✓ added source column');
  } else {
    console.log('  · source column already exists');
  }

  // 3. payments: add created_at column
  if (!(await columnExists(conn, 'payments', 'created_at'))) {
    await conn.query(`ALTER TABLE payments ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
    console.log('  ✓ added created_at column');
  } else {
    console.log('  · created_at column already exists');
  }

  // 4. webhook_events table
  console.log('\n--- webhook_events table ---');
  if (!(await tableExists(conn, 'webhook_events'))) {
    await conn.query(`
      CREATE TABLE webhook_events (
        id                    INT NOT NULL AUTO_INCREMENT,
        event_id              VARCHAR(64) NOT NULL,
        event_type            VARCHAR(64) NOT NULL,
        razorpay_order_id     VARCHAR(128) DEFAULT NULL,
        razorpay_payment_id   VARCHAR(128) DEFAULT NULL,
        payload               JSON NOT NULL,
        status                VARCHAR(32) NOT NULL DEFAULT 'received',
        error_message         TEXT DEFAULT NULL,
        processed_at          DATETIME DEFAULT NULL,
        created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY (event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
    console.log('  ✓ created webhook_events table');
  } else {
    console.log('  · webhook_events table already exists');
  }

  console.log('\nMigration complete.');
  await conn.end();
}

run().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
