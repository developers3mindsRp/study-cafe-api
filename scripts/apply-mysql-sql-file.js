#!/usr/bin/env node
/**
 * Run a .sql file against MySQL (no mysql CLI required). Uses root package "mysql2".
 * Env: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE (optional).
 * Use --no-database to connect without a default schema (e.g. user grants).
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const args = process.argv.slice(2);
  const noDatabase = args.includes('--no-database') || args.includes('--no-db');
  const file = args.find((a) => a.endsWith('.sql'));
  if (!file) {
    console.error('Usage: node scripts/apply-mysql-sql-file.js [--no-database] <file.sql>');
    process.exit(1);
  }
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = noDatabase ? undefined : process.env.MYSQL_DATABASE || 'studycafe_db';
  const sql = fs.readFileSync(abs, 'utf8');
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
