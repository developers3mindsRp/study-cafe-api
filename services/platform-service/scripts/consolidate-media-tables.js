#!/usr/bin/env node
/**
 * Idempotent migration: unified `media` table (WordPress legacy + admin library + icons).
 * Replaces `media_assets`. Safe for other modules — only touches `media` / `media_assets`.
 *
 * Changes applied:
 *   - media.label, media.category columns
 *   - media.url VARCHAR(512), media.mime_type VARCHAR(128)
 *   - Backfill category='library' for legacy rows
 *   - Backfill label from title where label is empty
 *   - Copy rows from media_assets (incl. mime_type when that column exists)
 *   - Drop media_assets
 *   - Indexes: idx_media_category, idx_media_url
 *
 * Run: npm run db:consolidate-media  (from services/platform-service)
 * Env: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 *
 * NOTE: Fresh / re-run WordPress sync already does this via migrate-wp-to-ms.js
 *       (ensureMediaTableSchema + migrateMedia + mergeLegacyMediaAssets).
 *       Use this script only when you cannot run the full WP migration.
 */
const mysql = require('mysql2/promise');

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [table],
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName],
  );
  return rows.length > 0;
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
    multipleStatements: true,
  });

  try {
    if (!(await tableExists(conn, 'media'))) {
      console.error('Table `media` does not exist. Run WP/schema migration first.');
      process.exit(1);
    }

    // ── 1. Schema: label + category ─────────────────────────────────────
    if (!(await columnExists(conn, 'media', 'label'))) {
      await conn.query('ALTER TABLE media ADD COLUMN label VARCHAR(128) NULL');
      console.log('Added media.label');
    } else {
      console.log('Skip: media.label already exists');
    }

    if (!(await columnExists(conn, 'media', 'category'))) {
      await conn.query(
        "ALTER TABLE media ADD COLUMN category VARCHAR(64) NULL DEFAULT 'library'",
      );
      console.log('Added media.category');
    } else {
      console.log('Skip: media.category already exists');
    }

    // ── 2. Widen url / mime_type (CDN paths + full MIME strings) ────────
    await conn.query('ALTER TABLE media MODIFY COLUMN url VARCHAR(512) NULL');
    await conn.query('ALTER TABLE media MODIFY COLUMN mime_type VARCHAR(128) NULL');
    console.log('Updated media.url (512) / media.mime_type (128)');

    // ── 3. Backfill legacy WordPress rows ───────────────────────────────
    const [catFill] = await conn.query(
      "UPDATE media SET category = 'library' WHERE category IS NULL",
    );
    console.log(`Backfill category=library: ${catFill.affectedRows ?? 0} rows`);

    const [labelFill] = await conn.query(`
      UPDATE media
      SET label = title
      WHERE (label IS NULL OR TRIM(label) = '')
        AND title IS NOT NULL AND TRIM(title) != ''
    `);
    console.log(`Backfill label from title: ${labelFill.affectedRows ?? 0} rows`);

    // ── 4. Merge media_assets → media ───────────────────────────────────
    if (await tableExists(conn, 'media_assets')) {
      const hasMime = await columnExists(conn, 'media_assets', 'mime_type');
      const mimeCol = hasMime ? 'ma.mime_type' : 'NULL';
      const [insert] = await conn.query(`
        INSERT INTO media (url, label, title, mime_type, category, created_at)
        SELECT ma.url, ma.label, ma.label, ${mimeCol}, ma.category, ma.created_at
        FROM media_assets ma
        WHERE ma.url IS NOT NULL AND TRIM(ma.url) != ''
          AND NOT EXISTS (
            SELECT 1 FROM media m
            WHERE m.url = ma.url AND (m.category <=> ma.category)
          )
      `);
      console.log(
        `Copied from media_assets: ${insert.affectedRows ?? 0} rows` +
          (hasMime ? ' (with mime_type)' : ''),
      );

      await conn.query('DROP TABLE media_assets');
      console.log('Dropped media_assets');
    } else {
      console.log('Skip: media_assets already removed');
    }

    // ── 5. Indexes for library / icon queries ───────────────────────────
    if (!(await indexExists(conn, 'media', 'idx_media_category'))) {
      await conn.query('CREATE INDEX idx_media_category ON media (category)');
      console.log('Created idx_media_category');
    } else {
      console.log('Skip: idx_media_category already exists');
    }

    if (!(await indexExists(conn, 'media', 'idx_media_url'))) {
      await conn.query('CREATE INDEX idx_media_url ON media (url(191))');
      console.log('Created idx_media_url');
    } else {
      console.log('Skip: idx_media_url already exists');
    }

    console.log('OK: media tables consolidated (single `media` table for all assets)');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
