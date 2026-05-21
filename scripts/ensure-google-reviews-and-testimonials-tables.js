#!/usr/bin/env node
/**
 * Ensures google_reviews and testimonials tables with correct names.
 * Migrates legacy names when present:
 *   testimonials (text) → google_reviews
 *   media_testimonials → testimonials
 *
 * Usage (from study-cafe-api root):
 *   node scripts/ensure-google-reviews-and-testimonials-tables.js
 */

'use strict';

const path = require('path');
const { Sequelize } = require('sequelize');

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
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
  };
}

const GOOGLE_REVIEWS_SQL = `
  CREATE TABLE IF NOT EXISTS google_reviews (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(128) NULL,
    quote TEXT NOT NULL,
    rating TINYINT UNSIGNED NULL DEFAULT 5,
    reviewed_at VARCHAR(64) NULL,
    avatar_url VARCHAR(512) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

const TESTIMONIALS_SQL = `
  CREATE TABLE IF NOT EXISTS testimonials (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NULL,
    media_type ENUM('video', 'image') NOT NULL DEFAULT 'video',
    media_url VARCHAR(512) NOT NULL,
    video_url VARCHAR(512) NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

async function tableExists(seq, table) {
  const [rows] = await seq.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    { replacements: [mysqlConfig.database, table] },
  );
  return Number(rows[0]?.c ?? rows[0]?.C ?? 0) > 0;
}

async function columnExists(seq, table, column) {
  const [rows] = await seq.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    { replacements: [mysqlConfig.database, table, column] },
  );
  return Number(rows[0]?.c ?? rows[0]?.C ?? 0) > 0;
}

async function main() {
  const seq = new Sequelize(mysqlConfig.database, mysqlConfig.user, mysqlConfig.password, {
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    dialect: 'mysql',
    logging: false,
  });

  await seq.authenticate();
  console.log(`Connected to ${mysqlConfig.host}:${mysqlConfig.port}/${mysqlConfig.database}`);

  const hasLegacyTextTestimonials = await tableExists(seq, 'testimonials');
  const hasGoogleReviews = await tableExists(seq, 'google_reviews');

  // Legacy text table: testimonials (has quote, no media_type)
  if (hasLegacyTextTestimonials && !hasGoogleReviews) {
    const isTextTable = await columnExists(seq, 'testimonials', 'quote');
    const isMediaTable = await columnExists(seq, 'testimonials', 'media_type');
    if (isTextTable && !isMediaTable) {
      await seq.query('RENAME TABLE testimonials TO google_reviews', { raw: true });
      console.log('✅ Renamed testimonials → google_reviews');
    }
  }

  // Legacy media table: media_testimonials → testimonials
  if (await tableExists(seq, 'media_testimonials') && !(await tableExists(seq, 'testimonials'))) {
    await seq.query('RENAME TABLE media_testimonials TO testimonials', { raw: true });
    console.log('✅ Renamed media_testimonials → testimonials');
  }

  await seq.query(GOOGLE_REVIEWS_SQL.trim(), { raw: true });
  console.log('✅ google_reviews table ensured');

  await seq.query(TESTIMONIALS_SQL.trim(), { raw: true });
  console.log('✅ testimonials table ensured');

  // Add missing columns on google_reviews if table existed before migrations
  if (await tableExists(seq, 'google_reviews')) {
    if (!(await columnExists(seq, 'google_reviews', 'rating'))) {
      await seq.query(
        'ALTER TABLE google_reviews ADD COLUMN rating TINYINT UNSIGNED NULL DEFAULT 5 AFTER quote',
        { raw: true },
      );
      console.log('✅ Added google_reviews.rating');
    }
    if (!(await columnExists(seq, 'google_reviews', 'reviewed_at'))) {
      await seq.query(
        'ALTER TABLE google_reviews ADD COLUMN reviewed_at VARCHAR(64) NULL AFTER rating',
        { raw: true },
      );
      console.log('✅ Added google_reviews.reviewed_at');
    }
  }

  await seq.close();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
