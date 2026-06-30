#!/usr/bin/env node
/**
 * Backfill articles.meta_description from excerpt/sub_heading/content when empty.
 * Matches legacy WP theme behavior (ACF description first, else ~140-char body snippet).
 *
 * Usage:
 *   node scripts/backfill-article-meta-descriptions.js           # dry run
 *   node scripts/backfill-article-meta-descriptions.js --execute  # apply updates
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');
const { resolveModuleMetaDescription } = require('../shared/seoMetaDescription');

const BATCH = 500;

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

  try {
    console.log(`=== Backfill article meta_description (${execute ? 'EXECUTE' : 'DRY RUN'}) ===\n`);

    let lastId = 0;
    let scanned = 0;
    let needsUpdate = 0;
    let updated = 0;

    while (true) {
      const [rows] = await conn.query(
        `SELECT id, title, excerpt, sub_heading, meta_description, content
         FROM articles
         WHERE id > ?
           AND (meta_description IS NULL OR TRIM(meta_description) = '')
           AND content IS NOT NULL AND TRIM(content) != ''
         ORDER BY id
         LIMIT ?`,
        [lastId, BATCH]
      );

      if (!rows.length) break;

      for (const row of rows) {
        scanned += 1;
        lastId = row.id;
        const resolved = resolveModuleMetaDescription(row);
        if (!resolved) continue;
        needsUpdate += 1;

        if (execute) {
          const [result] = await conn.query(
            `UPDATE articles
             SET meta_description = ?
             WHERE id = ?
               AND (meta_description IS NULL OR TRIM(meta_description) = '')`,
            [resolved, row.id]
          );
          updated += Number(result?.affectedRows || 0);
        }
      }
    }

    console.log(`Articles scanned (empty meta + content): ${scanned}`);
    console.log(`Would update / updated:                 ${needsUpdate}${execute ? ` (applied: ${updated})` : ''}`);

    if (!execute && needsUpdate > 0) {
      console.log('\nRe-run with --execute to apply updates.');
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
