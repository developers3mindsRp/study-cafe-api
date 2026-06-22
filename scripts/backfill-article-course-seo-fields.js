#!/usr/bin/env node
/**
 * Backfill derived SEO fields on articles and courses from existing entity data.
 * Normally runs automatically at the end of migrate-wp-to-ms.js — use this script
 * only for a one-off fix on an existing DB without a full migration.
 *
 * Usage:
 *   node scripts/backfill-article-course-seo-fields.js           # dry run
 *   node scripts/backfill-article-course-seo-fields.js --execute # apply updates
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');
const { backfillEntitySeoFields } = require('./seo-migration-utils');

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
    console.log(`=== Backfill article/course SEO fields (${execute ? 'EXECUTE' : 'DRY RUN'}) ===`);
    console.log('(Also runs automatically after npm run migrate:wp-to-ms / npm run sync)\n');

    const report = await backfillEntitySeoFields(runQuery, { dryRun: !execute });

    if (execute) {
      console.log(`Updated articles: ${report.updated.articles}`);
      console.log(`Updated courses:  ${report.updated.courses}`);
    } else {
      console.log(`Articles needing backfill: ${report.articles}`);
      console.log(`Courses needing backfill:  ${report.courses}`);
      if (report.articles || report.courses) {
        console.log('\nRe-run with --execute to apply bulk updates.');
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
