#!/usr/bin/env node
/**
 * Creates `site_seo_routes` and seeds default public paths when empty.
 *
 *   npm run ensure-site-seo-routes
 */

'use strict';

const path = require('path');
const { Sequelize, QueryTypes } = require('sequelize');

try {
  require('dotenv').config({ path: path.resolve(__dirname, '../services/platform-service/.env') });
} catch (_) {}
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
} catch (_) {}

let mysqlConfig;
try {
  mysqlConfig = require('../services/platform-service/src/config').mysql;
} catch (_) {
  mysqlConfig = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || 'GDZ@p84i-F2X',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
  };
}

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

/** Initial rows if table is empty — same set as former hardcoded admin list. */
const SEED = [
  { path: '/', label: 'Home' },
  { path: '/about', label: 'About' },
  { path: '/contact', label: 'Contact' },
  { path: '/courses', label: 'Courses' },
  { path: '/All-courses', label: 'All courses' },
  { path: '/blogs', label: 'Blogs' },
  { path: '/blogs/finance', label: 'Blogs — Finance' },
  { path: '/blogs/blog-detail', label: 'Blogs — Blog detail' },
  { path: '/downloads', label: 'Downloads' },
  { path: '/downloads/accounts', label: 'Downloads — Accounts' },
  { path: '/downloads/details', label: 'Downloads — Details' },
  { path: '/plans', label: 'Plans' },
  { path: '/plans/premium-new', label: 'Plans — Premium (new)' },
  { path: '/upgrade-plan', label: 'Upgrade plan' },
  { path: '/payment', label: 'Payment' },
  { path: '/payment-success', label: 'Payment success' },
  { path: '/payment-detail', label: 'Payment detail' },
  { path: '/verify-certificate', label: 'Verify certificate' },
  { path: '/report', label: 'Report' },
];

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

  const countRows = await sequelize.query('SELECT COUNT(*) AS n FROM site_seo_routes', {
    type: QueryTypes.SELECT,
  });
  const n = Number(countRows?.[0]?.n ?? 0);

  if (n === 0) {
    console.log(`Seeding ${SEED.length} default routes…`);
    for (let i = 0; i < SEED.length; i += 1) {
      const { path: urlPath, label } = SEED[i];
      await sequelize.query(
        'INSERT INTO site_seo_routes (path, label, sort_order) VALUES (:path, :label, :so)',
        { replacements: { path: urlPath, label, so: i * 10 } }
      );
    }
    console.log('✅ Default routes inserted');
  } else {
    console.log(`Skipping seed (${n} rows already present)`);
  }

  await sequelize.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
