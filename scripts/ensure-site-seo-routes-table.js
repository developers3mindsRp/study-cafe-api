#!/usr/bin/env node
/**
 * Creates `site_seo_routes` and ensures canonical public paths exist.
 * Safe to re-run — only inserts missing paths.
 *
 *   node scripts/ensure-site-seo-routes-table.js
 */

'use strict';

const { Sequelize, QueryTypes } = require('sequelize');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const mysqlConfig = getMysqlConfig();

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS site_seo_routes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    path VARCHAR(500) NOT NULL,
    label VARCHAR(500) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY ux_site_seo_routes_path (path(255))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

/**
 * Core public routes used for SEO metadata pickers.
 * sort_order = index * 10 when inserted.
 */
const CANONICAL_SITE_PAGES = [
  { path: '/', label: 'Home', sort_order: 0 },
  { path: '/about', label: 'About', sort_order: 10 },
  { path: '/contact', label: 'Contact', sort_order: 20 },
  { path: '/courses', label: 'Courses', sort_order: 30 },
  { path: '/blogs', label: 'Blogs', sort_order: 40 },
  { path: '/downloads', label: 'Downloads', sort_order: 45 },
  { path: '/plans', label: 'Plans', sort_order: 50 },
  { path: '/privacy-policy', label: 'Privacy Policy', sort_order: 60 },
  { path: '/terms-of-use', label: 'Terms of Use', sort_order: 70 },
  { path: '/disclaimer', label: 'Disclaimer', sort_order: 80 },
  { path: '/refund-policy', label: 'Refund Policy', sort_order: 90 },
];

const MODULE_SEO_PATH_RE = [
  /^\/blogs\/.+$/i,
  /^\/course\/.+$/i,
  /^\/(.+)\.html$/i,
];

function isModuleSeoPath(path) {
  const p = String(path || '').trim();
  if (!p) return true;
  return MODULE_SEO_PATH_RE.some((re) => re.test(p));
}

async function upsertCanonicalPages(sequelize) {
  let inserted = 0;
  for (let i = 0; i < CANONICAL_SITE_PAGES.length; i += 1) {
    const { path, label, sort_order } = CANONICAL_SITE_PAGES[i];
    const [, meta] = await sequelize.query(
      `INSERT INTO site_seo_routes (path, label, sort_order)
       SELECT :path, :label, :so FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM site_seo_routes WHERE path = :path)`,
      { replacements: { path, label, so: sort_order } },
    );
    if (meta?.affectedRows > 0) inserted += 1;
  }
  return inserted;
}

/** Insert static seo_metadata paths that are not yet in site_seo_routes. */
async function syncMissingFromSeoMetadata(sequelize) {
  const rows = await sequelize.query(
    'SELECT page_slug AS path, page_name AS label FROM seo_metadata',
    { type: QueryTypes.SELECT },
  );

  const existing = await sequelize.query(
    'SELECT path FROM site_seo_routes',
    { type: QueryTypes.SELECT },
  );
  const existingPaths = new Set(existing.map((r) => String(r.path)));

  const maxRow = await sequelize.query(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM site_seo_routes',
    { type: QueryTypes.SELECT },
  );
  let sortOrder = Number(maxRow?.[0]?.m ?? 0) + 10;

  let inserted = 0;
  for (const row of rows) {
    const path = String(row.path || '').trim();
    if (!path || isModuleSeoPath(path) || existingPaths.has(path)) continue;

    await sequelize.query(
      'INSERT INTO site_seo_routes (path, label, sort_order) VALUES (:path, :label, :so)',
      { replacements: { path, label: String(row.label || path).trim() || path, so: sortOrder } },
    );
    existingPaths.add(path);
    sortOrder += 10;
    inserted += 1;
  }
  return inserted;
}

/** Keep canonical sort_order in sync when paths already exist. */
async function alignCanonicalSortOrders(sequelize) {
  let updated = 0;
  for (const { path, sort_order } of CANONICAL_SITE_PAGES) {
    const [, meta] = await sequelize.query(
      'UPDATE site_seo_routes SET sort_order = :so WHERE path = :path AND sort_order <> :so',
      { replacements: { path, so: sort_order } },
    );
    if (meta?.affectedRows > 0) updated += 1;
  }
  return updated;
}

async function main() {
  const sequelize = new Sequelize(mysqlConfig.database, mysqlConfig.user, mysqlConfig.password, {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    dialect: 'mysql',
    logging: false,
  });

  await sequelize.authenticate();
  console.log(`Connected to ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);

  await sequelize.query(CREATE_TABLE.trim());
  console.log('✅ site_seo_routes table ensured');

  const canonicalInserted = await upsertCanonicalPages(sequelize);
  console.log(`✅ Canonical site pages: ${canonicalInserted} new row(s)`);

  const sortAligned = await alignCanonicalSortOrders(sequelize);
  if (sortAligned > 0) {
    console.log(`✅ Canonical sort_order aligned: ${sortAligned} row(s)`);
  }

  const seoSynced = await syncMissingFromSeoMetadata(sequelize);
  console.log(`✅ SEO metadata sync: ${seoSynced} new row(s)`);

  const countRows = await sequelize.query('SELECT COUNT(*) AS n FROM site_seo_routes', {
    type: QueryTypes.SELECT,
  });
  console.log(`Total site_seo_routes rows: ${countRows?.[0]?.n ?? 0}`);

  await sequelize.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
