#!/usr/bin/env node
/**
 * Remove duplicate seo_metadata rows for articles and courses.
 * Normally runs automatically at the end of migrate-wp-to-ms.js — use this script
 * only for a one-off cleanup on an existing DB without a full migration.
 *
 * Usage:
 *   node scripts/cleanup-module-seo-metadata.js           # dry run (default)
 *   node scripts/cleanup-module-seo-metadata.js --execute   # delete rows
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');
const { cleanupModuleSeoMetadata } = require('./seo-migration-utils');

async function main() {
  const execute = process.argv.includes('--execute');
  const db = getMysqlConfig();
  const conn = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.database,
  });

  const runQuery = async (sql, params) => {
    const [result] = await conn.query(sql, params);
    return result;
  };

  try {
    console.log('=== Cleanup module SEO metadata ===');
    console.log(`Mode: ${execute ? 'EXECUTE (delete)' : 'DRY RUN'}`);
    console.log('(Also runs automatically after npm run migrate:wp-to-ms / npm run sync)\n');

    const report = await cleanupModuleSeoMetadata(runQuery, { dryRun: !execute });

    if (execute) {
      console.log(`Deleted ${report.deleted} row(s).`);
    } else {
      console.log(`Module-managed rows to remove: ${report.wouldDelete}`);
      if (report.wouldDelete) {
        console.log('\nRe-run with --execute to delete these rows.');
      } else {
        console.log('Nothing to clean up.');
      }
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
