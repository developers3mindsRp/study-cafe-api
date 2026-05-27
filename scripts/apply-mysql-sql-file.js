#!/usr/bin/env node
/**
 * Run a .sql file against MySQL (no mysql CLI required). Uses root package "mysql2".
 * Env: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE (optional).
 * Use --no-database to connect without a default schema (e.g. user grants).
 *
 * SQL files may use __MYSQL_PASSWORD__ as a placeholder replaced from MYSQL_PASSWORD.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { mysqlConfig, required } = require('../shared/env');

async function main() {
  const args = process.argv.slice(2);
  const noDatabase = args.includes('--no-database') || args.includes('--no-db');
  const file = args.find((a) => a.endsWith('.sql'));
  if (!file) {
    console.error('Usage: node scripts/apply-mysql-sql-file.js [--no-database] <file.sql>');
    process.exit(1);
  }
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const db = mysqlConfig();
  const host = db.host;
  const port = db.port;
  const user = db.user;
  const password = db.password;
  const database = noDatabase ? undefined : db.database;
  let sql = fs.readFileSync(abs, 'utf8');
  if (sql.includes('__MYSQL_PASSWORD__')) {
    sql = sql.replaceAll('__MYSQL_PASSWORD__', required('MYSQL_PASSWORD'));
  }
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
  } finally {
    await conn.end();
  }
  console.log('OK:', file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
