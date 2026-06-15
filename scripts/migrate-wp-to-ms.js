#!/usr/bin/env node
/**
 * migrate-wp-to-ms.js
 *
 * Sync data from source DB (sc_* / users on port 3306) into the
 * microservices DB (port 3306 by default). Re-runnable and safe:
 *   - Source-synced tables (users, articles, courses, orders, etc.)
 *     are refreshed from source on every run.
 *   - Admin-managed tables (home_sections, faqs, testimonials, cms_pages,
 *     footer_data, states, payment_config, admin_logs, batch_enrollments,
 *     materials, payments, outbox_events, roles) are NEVER truncated;
 *     data you add via the admin panel is preserved across runs.
 *
 * Media: single `media` table (WordPress sc_media → media with category=library).
 * Legacy `media_assets` (admin icons) is merged after WP media import, then dropped.
 * No separate consolidate migration needed when using this full sync.
 *
 * Usage:
 *   node scripts/migrate-wp-to-ms.js
 *   npm run migrate:wp-to-ms
 *
 * Config: defaults below; override via env (or .env):
 *   MIGRATION_SRC_HOST, MIGRATION_SRC_PORT, MIGRATION_SRC_USER, MIGRATION_SRC_PASSWORD, MIGRATION_SRC_DATABASE
 *   MIGRATION_TGT_HOST, MIGRATION_TGT_PORT, MIGRATION_TGT_USER, MIGRATION_TGT_PASSWORD, MIGRATION_TGT_DATABASE
 */

'use strict';

try { require('../shared/env'); } catch (_) { }

const { Sequelize, QueryTypes } = require('sequelize');
const {
    rewriteStudycafeUploadUrl,
    rewriteStudycafeUploadUrlsInContent,
} = require('../shared/mediaUrl');

const { migrationSrcConfig, migrationTgtConfig } = require('../shared/env');

const SRC_CONFIG = migrationSrcConfig();
const TGT_CONFIG = migrationTgtConfig();

const BATCH = 500;

// Global reference — set in main(), used by esc()
let _tgt;
// Source users table: 'sc_users' or 'users' (if rename was run in database-migrations project)
let _srcUsersTable = 'sc_users';

async function main() {
    const src = new Sequelize(SRC_CONFIG.database, SRC_CONFIG.user, SRC_CONFIG.password, {
        host: SRC_CONFIG.host, port: SRC_CONFIG.port, dialect: 'mysql', logging: false,
    });
    const tgt = new Sequelize(TGT_CONFIG.database, TGT_CONFIG.user, TGT_CONFIG.password, {
        host: TGT_CONFIG.host, port: TGT_CONFIG.port, dialect: 'mysql', logging: false,
    });
    _tgt = tgt;

    await src.authenticate();
    console.log(`✅ Connected to SOURCE (${SRC_CONFIG.host}:${SRC_CONFIG.port}/${SRC_CONFIG.database})`);
    await tgt.authenticate();
    console.log(`✅ Connected to TARGET (${TGT_CONFIG.host}:${TGT_CONFIG.port}/${TGT_CONFIG.database})`);

    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('sc_users','users')",
        { replacements: [SRC_CONFIG.database], type: QueryTypes.SELECT }
    );
    if (tables.some(t => t.TABLE_NAME === 'sc_users')) _srcUsersTable = 'sc_users';
    else if (tables.some(t => t.TABLE_NAME === 'users')) _srcUsersTable = 'users';
    else throw new Error('Source DB has neither sc_users nor users table. Run database-migrations: npm run migrate && npm run migrate:data');
    console.log(`   Using source users table: ${_srcUsersTable}\n`);

    // ──────────── Create tables ────────────
    console.log('\n📦 Creating tables in target DB...');
    await createAllTables(tgt);
    console.log('✅ All tables created / synced.\n');

    // ──────────── Clear existing data on target DB ────────────
    console.log('🗑️  Clearing existing data on target DB...');
    await clearTargetDatabase(tgt);
    console.log('✅ Target DB cleared.\n');

    // ──────────── Ensure auth roles exist ────────────
    await ensureDefaultRoles(tgt);

    // ──────────── Migrate data ────────────
    await migrateUsers(src, tgt);
    await migrateUserMemberships(src, tgt);
    await migratePremiumPlans(src, tgt);
    await migrateCategories(src, tgt);
    await migrateTags(src, tgt);
    await migrateArticleTypes(src, tgt);
    await migrateCourts(src, tgt);
    await migrateCourseCats(src, tgt);
    await migrateFileCats(src, tgt);
    await migrateArticles(src, tgt);
    await migrateArticleJunctions(src, tgt);
    await migrateComments(src, tgt);
    await migrateCourses(src, tgt);
    await migrateBatches(src, tgt);
    await migrateSessions(src, tgt);
    await migrateRecordings(src, tgt);
    await migratePlanCourses(src, tgt);
    await migrateCourseJunctions(src, tgt);
    await migrateOrders(src, tgt);
    await migrateCoupons(src, tgt);
    await migrateFiles(src, tgt);
    await migrateFileCategories(src, tgt);
    await migratePages(src, tgt);
    await seedCmsPagesFromSource(src, tgt);
    await seedAffiliatePage(src, tgt);
    await seedSeoMetadata(src, tgt);
    await migrateRedirections(src, tgt);
    await migrateWpLinks(src, tgt);
    await migrateMedia(src, tgt);
    await mergeLegacyMediaAssets(tgt);
    await migrateForumTopics(src, tgt);
    await migrateEnrollments(src, tgt);
    await migrateUserCourses(src, tgt);
    await migrateBatchEnrollments(src, tgt);
    await migrateCourseAuthors(src, tgt);
    await migrateAffiliateData(src, tgt);

    await applyPostMigrationDataPatches(tgt);

    console.log('\n════════════════════════════════════');
    console.log('  ✅ Migration complete!');
    console.log('════════════════════════════════════\n');

    await src.close();
    await tgt.close();
}

// ──── Escape helpers — uses mysql2's built-in escaping ────
function esc(val, maxLen = 65535) {
    if (val === null || val === undefined || val === '') return 'NULL';
    let s = String(val);
    if (maxLen && s.length > maxLen) s = s.substring(0, maxLen);
    return _tgt.escape(s);
}
function escDate(val) {
    if (!val) return 'NULL';
    const d = new Date(val);
    if (isNaN(d.getTime())) return 'NULL';
    return `'${d.toISOString().slice(0, 19).replace('T', ' ')}'`;
}

function escUploadUrl(val, maxLen = 65535) {
    return esc(rewriteStudycafeUploadUrl(val), maxLen);
}

function escUploadContent(val, maxLen = 65535) {
    return esc(rewriteStudycafeUploadUrlsInContent(val), maxLen);
}

// ──── Create all tables ────
async function createAllTables(tgt) {
    // Use raw SQL to create tables — gives us full control over types
    const ddl = `
    -- Users (auth-service)
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_user_id BIGINT UNSIGNED UNIQUE,
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255),
      name VARCHAR(255),
      display_name VARCHAR(250),
      login VARCHAR(60),
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      user_nicename VARCHAR(50),
      user_url VARCHAR(500),
      phone VARCHAR(20),
      profession VARCHAR(200),
      designation VARCHAR(200),
      company VARCHAR(200),
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100),
      profile_pic_url VARCHAR(500),
      membership VARCHAR(50),
      plan TEXT,
      role_id INT,
      role VARCHAR(50),
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      status VARCHAR(20),
      permission_overrides JSON,
      facebook VARCHAR(500),
      twitter VARCHAR(500),
      linkedin VARCHAR(500),
      instagram VARCHAR(500),
      youtube VARCHAR(500),
      gst VARCHAR(100),
      account_status VARCHAR(50),
      referral_code VARCHAR(32) UNIQUE,
      referred_by BIGINT UNSIGNED,
      referred_at DATETIME,
      bio TEXT NULL,
      email_verified_at DATETIME NULL,
      created_at DATETIME,
      updated_at DATETIME,
      UNIQUE KEY idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Roles (auth-service)
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- User Courses (auth-service)
    CREATE TABLE IF NOT EXISTS user_courses (
      user_id BIGINT UNSIGNED,
      course_id BIGINT UNSIGNED,
      order_id VARCHAR(128),
      expires_at DATETIME NULL,
      PRIMARY KEY (user_id, course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Per-session learning progress (course-service)
    CREATE TABLE IF NOT EXISTS user_course_progress (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      session_id BIGINT UNSIGNED NOT NULL,
      batch_id BIGINT UNSIGNED NOT NULL,
      status ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
      watch_seconds INT UNSIGNED NOT NULL DEFAULT 0,
      duration_seconds INT UNSIGNED NULL,
      completed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_course_progress_user_session (user_id, session_id),
      KEY idx_ucp_user (user_id),
      KEY idx_ucp_course (course_id),
      KEY idx_ucp_session (session_id),
      KEY idx_ucp_user_course (user_id, course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Course completion certificates (course-service)
    CREATE TABLE IF NOT EXISTS certificates (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      certificate_number VARCHAR(32) NOT NULL,
      issued_at DATETIME NOT NULL,
      pdf_url VARCHAR(512) NULL,
      verification_token VARCHAR(64) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cert_number (certificate_number),
      UNIQUE KEY uq_cert_verify (verification_token),
      UNIQUE KEY uq_cert_user_course (user_id, course_id),
      KEY idx_cert_user (user_id),
      KEY idx_cert_course (course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- User Memberships (auth-service)
    CREATE TABLE IF NOT EXISTS user_memberships (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      membership_type VARCHAR(64) NOT NULL,
      order_id VARCHAR(128),
      starts_at DATETIME NOT NULL,
      expires_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Categories (platform-service)
    CREATE TABLE IF NOT EXISTS categories (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_term_id BIGINT UNSIGNED,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(200),
      parent_id BIGINT UNSIGNED,
      description TEXT,
      image_url VARCHAR(500)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Tags (platform-service)
    CREATE TABLE IF NOT EXISTS tags (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_term_id BIGINT UNSIGNED,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(200)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Article Types (platform-service)
    CREATE TABLE IF NOT EXISTS article_types (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_term_id BIGINT UNSIGNED,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(200)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Courts (platform-service)
    CREATE TABLE IF NOT EXISTS courts (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_term_id BIGINT UNSIGNED,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(200)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Articles (platform-service)
    CREATE TABLE IF NOT EXISTS articles (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      title TEXT NOT NULL,
      slug VARCHAR(200),
      content LONGTEXT,
      excerpt TEXT,
      sub_heading TEXT,
      author_id BIGINT UNSIGNED,
      thumbnail_url VARCHAR(500),
      views INT UNSIGNED DEFAULT 0,
      meta_title VARCHAR(500),
      meta_description TEXT,
      meta_keywords VARCHAR(500),
      canonical_url VARCHAR(1000),
      robots VARCHAR(255),
      og_title VARCHAR(255),
      og_description TEXT,
      og_image_url VARCHAR(500),
      thumbnail_alt VARCHAR(500),
      thumbnail_link_url VARCHAR(500),
      thumbnail_caption TEXT,
      case_name TEXT,
      citation TEXT,
      appeal_number VARCHAR(500),
      judgement_date VARCHAR(100),
      assessment_year VARCHAR(50),
      court_name VARCHAR(300),
      section TEXT,
      noti_no VARCHAR(200),
      noti_date VARCHAR(100),
      type_of_tax VARCHAR(100),
      ext_link VARCHAR(500),
      upload_url VARCHAR(500),
      rel_download_url VARCHAR(500),
      external_links TEXT,
      status VARCHAR(20) DEFAULT 'publish',
      blog_access_tier VARCHAR(20) NOT NULL DEFAULT 'free',
      published_at DATETIME,
      created_at DATETIME,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Article junction tables
    CREATE TABLE IF NOT EXISTS article_categories (
      article_id BIGINT UNSIGNED,
      category_id BIGINT UNSIGNED,
      PRIMARY KEY (article_id, category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS article_tags (
      article_id BIGINT UNSIGNED,
      tag_id BIGINT UNSIGNED,
      PRIMARY KEY (article_id, tag_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS article_types_map (
      article_id BIGINT UNSIGNED,
      article_type_id BIGINT UNSIGNED,
      PRIMARY KEY (article_id, article_type_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS article_courts (
      article_id BIGINT UNSIGNED,
      court_id BIGINT UNSIGNED,
      PRIMARY KEY (article_id, court_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Comments (platform-service)
    CREATE TABLE IF NOT EXISTS comments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_comment_id BIGINT UNSIGNED,
      article_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED,
      author_name VARCHAR(250),
      author_email VARCHAR(100),
      content TEXT NOT NULL,
      approved TINYINT(1) DEFAULT 1,
      parent_id BIGINT UNSIGNED,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Courses (course-service)
    CREATE TABLE IF NOT EXISTS courses (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      title VARCHAR(500) NOT NULL DEFAULT '',
      short_title VARCHAR(500),
      slug VARCHAR(200),
      brief_description TEXT,
      description LONGTEXT,
      curriculum LONGTEXT,
      learn_outcomes TEXT,
      requirements TEXT,
      terms_conditions TEXT,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      sale_price DECIMAL(10,2),
      enrolled_count INT DEFAULT 0,
      ratings DECIMAL(3,2),
      rating_users INT DEFAULT 0,
      thumbnail_url VARCHAR(500),
      youtube_url VARCHAR(500),
      language TEXT,
      course_type VARCHAR(50),
      taxable TINYINT(1) DEFAULT 0,
      keywords VARCHAR(500),
      meta_title VARCHAR(500),
      meta_description TEXT,
      meta_keywords VARCHAR(500),
      canonical_url VARCHAR(1000),
      robots VARCHAR(255),
      og_title VARCHAR(255),
      og_description TEXT,
      og_image_url VARCHAR(500),
      faqs LONGTEXT,
      feedback LONGTEXT,
      includes_info LONGTEXT,
      course_includes LONGTEXT COMMENT 'JSON [{image,title}] banner. WP source may omit',
      certifications TEXT,
      gateway VARCHAR(200),
      is_published TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(20) DEFAULT 'draft',
      start_date DATETIME,
      end_date DATETIME,
      affiliate_commission DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at DATETIME,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Course Cats (course-service)
    CREATE TABLE IF NOT EXISTS course_cats (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_term_id BIGINT UNSIGNED,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(200),
      is_featured TINYINT(1) NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Course Categories junction
    CREATE TABLE IF NOT EXISTS course_categories (
      course_id BIGINT UNSIGNED,
      course_cat_id BIGINT UNSIGNED,
      PRIMARY KEY (course_id, course_cat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- File Cats (platform-service, for downloads taxonomy)
    CREATE TABLE IF NOT EXISTS file_cats (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_term_id BIGINT UNSIGNED,
      name VARCHAR(200) NOT NULL,
      slug VARCHAR(200)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Files / Downloads (platform-service)
    CREATE TABLE IF NOT EXISTS files (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      title TEXT NOT NULL,
      slug VARCHAR(200),
      file_url VARCHAR(500),
      author_id BIGINT UNSIGNED,
      views INT UNSIGNED DEFAULT 0,
      status VARCHAR(20) DEFAULT 'publish',
      meta_title VARCHAR(500),
      meta_description TEXT,
      meta_keywords VARCHAR(500),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS file_categories (
      file_id BIGINT UNSIGNED,
      file_cat_id BIGINT UNSIGNED,
      PRIMARY KEY (file_id, file_cat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Pages (platform-service)
    CREATE TABLE IF NOT EXISTS pages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      title VARCHAR(500) NOT NULL,
      slug VARCHAR(200),
      content LONGTEXT,
      template VARCHAR(100),
      meta_title VARCHAR(500),
      meta_description TEXT,
      meta_keywords VARCHAR(500),
      status VARCHAR(20) DEFAULT 'publish',
      created_at DATETIME,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- CMS pages (editable page content, never truncated by migration)
    CREATE TABLE IF NOT EXISTS cms_pages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(500),
      content LONGTEXT,
      meta JSON,
      created_at DATETIME,
      updated_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Redirections (platform-service)
    CREATE TABLE IF NOT EXISTS redirections (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_url VARCHAR(500) NOT NULL,
      target_url VARCHAR(500),
      match_type VARCHAR(50),
      status VARCHAR(20) DEFAULT 'enabled'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Media (WordPress legacy attachments + admin library + icons)
    CREATE TABLE IF NOT EXISTS media (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      title VARCHAR(500),
      label VARCHAR(128),
      url VARCHAR(512),
      mime_type VARCHAR(128),
      category VARCHAR(64) DEFAULT 'library',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_media_category (category),
      KEY idx_media_url (url(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Forum Topics (platform-service)
    CREATE TABLE IF NOT EXISTS forum_topics (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      title TEXT NOT NULL,
      slug VARCHAR(200),
      content LONGTEXT,
      forum_name VARCHAR(200),
      author_id BIGINT UNSIGNED,
      status VARCHAR(20) DEFAULT 'publish',
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Course Authors
    CREATE TABLE IF NOT EXISTS course_authors (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      course_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      sort_order INT DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Enrollments (course-service)
    CREATE TABLE IF NOT EXISTS enrollments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      order_id BIGINT UNSIGNED,
      enrolled_at DATETIME,
      UNIQUE KEY uq_enrollment_user_course (user_id, course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Batches (course-service)
    CREATE TABLE IF NOT EXISTS batches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_id INT NOT NULL,
      name VARCHAR(255) NOT NULL DEFAULT '',
      start_date DATE,
      end_date DATE,
      meet_link VARCHAR(512),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Sessions (course-service)
    CREATE TABLE IF NOT EXISTS sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id INT NOT NULL,
      day_number INT NOT NULL DEFAULT 1,
      section_index INT NOT NULL DEFAULT 0,
      title VARCHAR(255),
      section_title VARCHAR(255),
      duration INT,
      scheduled_at DATETIME,
      meet_link VARCHAR(512)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Recordings (course-service)
    CREATE TABLE IF NOT EXISTS recordings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      session_id INT NOT NULL,
      url VARCHAR(512) NOT NULL DEFAULT '',
      source VARCHAR(255),
      is_visible BOOLEAN NOT NULL DEFAULT false
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Batch Enrollments (course-service)
    CREATE TABLE IF NOT EXISTS batch_enrollments (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      batch_id INT NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      enrolled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_batch_user (batch_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Materials (course-service)
    CREATE TABLE IF NOT EXISTS materials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      course_id INT NOT NULL,
      title VARCHAR(255),
      url VARCHAR(512) NOT NULL DEFAULT '',
      type VARCHAR(64)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Orders (order-service)
    CREATE TABLE IF NOT EXISTS orders (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED UNIQUE,
      order_id VARCHAR(128) UNIQUE,
      user_id BIGINT UNSIGNED,
      course_id BIGINT UNSIGNED,
      type VARCHAR(32),
      entity_id VARCHAR(64),
      amount DECIMAL(10,2),
      original_amount DECIMAL(10,2),
      coupon_code VARCHAR(100),
      coupon_discount DECIMAL(10,2) DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      buyer_name VARCHAR(250),
      buyer_email VARCHAR(255),
      buyer_mobile VARCHAR(20),
      rp_payment_id VARCHAR(100),
      razorpay_order_id VARCHAR(128),
      affiliate VARCHAR(200),
      certificate_name VARCHAR(300),
      certificate_issue_date VARCHAR(50),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      gateway VARCHAR(50),
      wp_post_status VARCHAR(20),
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Payments (order-service)
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id BIGINT UNSIGNED NOT NULL,
      razorpay_payment_id VARCHAR(128),
      razorpay_signature VARCHAR(255),
      amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(32) NOT NULL,
      source VARCHAR(32) DEFAULT 'checkout',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_payment_id_status (razorpay_payment_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Webhook Events (order-service — idempotency for Razorpay webhooks)
    CREATE TABLE IF NOT EXISTS webhook_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      event_id VARCHAR(64) NOT NULL UNIQUE,
      event_type VARCHAR(64) NOT NULL,
      razorpay_order_id VARCHAR(128),
      razorpay_payment_id VARCHAR(128),
      payload JSON NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'received',
      error_message TEXT,
      processed_at DATETIME,
      created_at DATETIME NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Outbox Events (order-service)
    CREATE TABLE IF NOT EXISTS outbox_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      aggregate_type VARCHAR(64) NOT NULL DEFAULT 'order',
      aggregate_id VARCHAR(128) NOT NULL,
      event_type VARCHAR(64) NOT NULL,
      payload JSON NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      processed_at DATETIME NULL,
      retry_count INT NOT NULL DEFAULT 0,
      next_retry_at DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Coupons (order-service)
    CREATE TABLE IF NOT EXISTS coupons (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      wp_post_id BIGINT UNSIGNED,
      code VARCHAR(100) NOT NULL,
      description TEXT,
      type VARCHAR(20),
      value DECIMAL(10,2),
      min_order DECIMAL(10,2),
      max_discount DECIMAL(10,2),
      discount_on VARCHAR(50),
      start_date DATETIME,
      expire_date DATETIME,
      status VARCHAR(20),
      visibility ENUM('public','hidden') NOT NULL DEFAULT 'public',
      usage_limit INT DEFAULT NULL,
      per_user_limit INT NOT NULL DEFAULT 1,
      created_at DATETIME
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Coupon Usages (order-service — per-user coupon redemption tracking)
    CREATE TABLE IF NOT EXISTS coupon_usages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      coupon_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      order_id VARCHAR(128) NOT NULL,
      created_at DATETIME NOT NULL,
      UNIQUE KEY coupon_usages_coupon_id_order_id (coupon_id, order_id),
      KEY coupon_usages_coupon_id_user_id (coupon_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Admin Logs (admin-service)
    CREATE TABLE IF NOT EXISTS admin_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admin_id INT,
      action VARCHAR(128),
      resource VARCHAR(64),
      resource_id VARCHAR(64),
      details JSON,
      ip_address VARCHAR(45),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Payment Config (admin-service)
    CREATE TABLE IF NOT EXISTS payment_config (
      id INT AUTO_INCREMENT PRIMARY KEY,
      key_name VARCHAR(128) NOT NULL UNIQUE,
      key_value TEXT,
      razorpay_key_id VARCHAR(255),
      razorpay_key_secret VARCHAR(255),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- SEO Metadata (platform-service)
    CREATE TABLE IF NOT EXISTS seo_metadata (
      id INT AUTO_INCREMENT PRIMARY KEY,
      page_name VARCHAR(255) NOT NULL,
      page_slug VARCHAR(255) NOT NULL UNIQUE,
      meta_title VARCHAR(255) NOT NULL,
      meta_description TEXT,
      robots VARCHAR(255) DEFAULT 'index, follow',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Contact Inquiries (platform-service)
    CREATE TABLE IF NOT EXISTS contact_inquiries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL,
      mobile_number VARCHAR(30) NOT NULL,
      country_code VARCHAR(8) DEFAULT 'IN',
      subject VARCHAR(255),
      message TEXT NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Affiliate History (course-service)
    CREATE TABLE IF NOT EXISTS affiliate_history (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      course_id BIGINT UNSIGNED,
      entity_type VARCHAR(32) DEFAULT 'course',
      entity_id VARCHAR(64),
      user_id BIGINT UNSIGNED NOT NULL,
      affiliate_id BIGINT UNSIGNED NOT NULL,
      order_id VARCHAR(128) UNIQUE,
      order_amount DECIMAL(10,2),
      commission_amount DECIMAL(10,2) NOT NULL,
      status ENUM('pending','confirmed','expired') NOT NULL DEFAULT 'confirmed',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ah_affiliate (affiliate_id),
      KEY idx_ah_user (user_id),
      KEY idx_ah_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Affiliate Balances (course-service)
    CREATE TABLE IF NOT EXISTS affiliate_balances (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      affiliate_id BIGINT UNSIGNED NOT NULL UNIQUE,
      total_earned DECIMAL(10,2) NOT NULL DEFAULT 0,
      total_withdrawn DECIMAL(10,2) NOT NULL DEFAULT 0,
      current_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Withdrawal Requests (course-service)
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      affiliate_id BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      remarks TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_wr_affiliate (affiliate_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Home Sections (platform-service). meta = JSON for hero/features/stats/testimonial_highlight.
    CREATE TABLE IF NOT EXISTS home_sections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      section_key VARCHAR(64) NOT NULL UNIQUE,
      title VARCHAR(255),
      content TEXT,
      meta JSON,
      sort_order INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- States (platform-service)
    CREATE TABLE IF NOT EXISTS states (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL UNIQUE,
      code VARCHAR(10)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Testimonials (platform-service)
    CREATE TABLE IF NOT EXISTS testimonials (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(128),
      quote TEXT NOT NULL,
      avatar_url VARCHAR(512),
      sort_order INT DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- FAQs (platform-service)
    CREATE TABLE IF NOT EXISTS faqs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Footer Data (platform-service)
    CREATE TABLE IF NOT EXISTS footer_data (
      id INT AUTO_INCREMENT PRIMARY KEY,
      section_key VARCHAR(64) NOT NULL UNIQUE,
      content JSON,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Plan Comparison Features (platform-service): master list of rows shown in comparison table
    CREATE TABLE IF NOT EXISTS plan_comparison_features (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Plan Feature Availability: which plans include each comparison feature
    CREATE TABLE IF NOT EXISTS plan_feature_availability (
      plan_id    INT NOT NULL,
      feature_id INT NOT NULL,
      available  TINYINT(1) NOT NULL DEFAULT 0,
      PRIMARY KEY (plan_id, feature_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Premium Plans (platform-service)
    CREATE TABLE IF NOT EXISTS premium_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(128),
      description TEXT,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      currency VARCHAR(10) NOT NULL DEFAULT 'INR',
      duration_days INT DEFAULT 365,
      is_lifetime TINYINT(1) NOT NULL DEFAULT 0,
      features JSON,
      sort_order INT NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      is_popular TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Plan–Course: which courses are included in each membership plan (from WP rel_course)
    CREATE TABLE IF NOT EXISTS plan_courses (
      plan_id INT NOT NULL,
      course_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (plan_id, course_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    -- Plan–Course category: include all courses under selected categories in this plan
    CREATE TABLE IF NOT EXISTS plan_course_categories (
      plan_id INT NOT NULL,
      course_cat_id BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (plan_id, course_cat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

    // Split by ; and run each statement
    const stmts = ddl.split(';').map(s => s.trim()).filter(s => s.length > 10);
    for (const stmt of stmts) {
        await tgt.query(stmt, { raw: true });
    }

    // Ensure premium_plans has columns expected by platform-service (for existing DBs)
    await ensurePremiumPlansColumns(tgt);
    // Unified media table (label, category, indexes) for existing DBs created before this schema
    await ensureMediaTableSchema(tgt);
    // SEO + notification columns added after the original schema (idempotent on existing DBs)
    await ensureMigratedColumns(tgt);
}

/**
 * Idempotently add SEO + notification columns to target tables that may predate
 * them on existing (production) databases. Each ALTER is guarded against the
 * "duplicate column" error so this is safe to run on every migration.
 */
async function ensureMigratedColumns(tgt) {
    const alters = [
        // Articles: notification tax type + extended SEO/thumbnail columns
        "ALTER TABLE articles ADD COLUMN type_of_tax VARCHAR(100) NULL",
        "ALTER TABLE articles ADD COLUMN canonical_url VARCHAR(1000) NULL",
        "ALTER TABLE articles ADD COLUMN robots VARCHAR(255) NULL",
        "ALTER TABLE articles ADD COLUMN og_title VARCHAR(255) NULL",
        "ALTER TABLE articles ADD COLUMN og_description TEXT NULL",
        "ALTER TABLE articles ADD COLUMN og_image_url VARCHAR(500) NULL",
        "ALTER TABLE articles ADD COLUMN thumbnail_alt VARCHAR(500) NULL",
        "ALTER TABLE articles ADD COLUMN thumbnail_link_url VARCHAR(500) NULL",
        "ALTER TABLE articles ADD COLUMN thumbnail_caption TEXT NULL",
        // Courses: full SEO set
        "ALTER TABLE courses ADD COLUMN meta_title VARCHAR(500) NULL",
        "ALTER TABLE courses ADD COLUMN meta_description TEXT NULL",
        "ALTER TABLE courses ADD COLUMN meta_keywords VARCHAR(500) NULL",
        "ALTER TABLE courses ADD COLUMN canonical_url VARCHAR(1000) NULL",
        "ALTER TABLE courses ADD COLUMN robots VARCHAR(255) NULL",
        "ALTER TABLE courses ADD COLUMN og_title VARCHAR(255) NULL",
        "ALTER TABLE courses ADD COLUMN og_description TEXT NULL",
        "ALTER TABLE courses ADD COLUMN og_image_url VARCHAR(500) NULL",
        // Categories: description + image
        "ALTER TABLE categories ADD COLUMN description TEXT NULL",
        "ALTER TABLE categories ADD COLUMN image_url VARCHAR(500) NULL",
        // Pages: SEO set
        "ALTER TABLE pages ADD COLUMN meta_title VARCHAR(500) NULL",
        "ALTER TABLE pages ADD COLUMN meta_description TEXT NULL",
        "ALTER TABLE pages ADD COLUMN meta_keywords VARCHAR(500) NULL",
        // Orders: WP workflow status (publish = active, draft = expired) drives My Courses split
        "ALTER TABLE orders ADD COLUMN wp_post_status VARCHAR(20) NULL",
        // User courses: access window end (NULL = lifetime/active; past date = expired)
        "ALTER TABLE user_courses ADD COLUMN expires_at DATETIME NULL",
    ];
    for (const sql of alters) {
        try {
            await tgt.query(sql, { raw: true });
        } catch (e) {
            if (e.original && e.original.code === 'ER_DUP_FIELDNAME') continue;
            if (e.message && e.message.includes('Duplicate column name')) continue;
            if (e.original && e.original.code === 'ER_NO_SUCH_TABLE') continue;
            throw e;
        }
    }

    // Deduplicate enrollments by (user_id, course_id) then add a unique key so
    // future syncs/inserts can't create duplicate course rows in a user's profile.
    try {
        const idx = await tgt.query(
            "SHOW INDEX FROM enrollments WHERE Key_name = 'uq_enrollment_user_course'",
            { type: QueryTypes.SELECT }
        );
        if (!idx.length) {
            // Remove dupes, keeping the lowest id per (user_id, course_id).
            await tgt.query(
                `DELETE e1 FROM enrollments e1
                 INNER JOIN enrollments e2
                   ON e1.user_id = e2.user_id AND e1.course_id = e2.course_id AND e1.id > e2.id`,
                { raw: true }
            );
            await tgt.query(
                'ALTER TABLE enrollments ADD UNIQUE KEY uq_enrollment_user_course (user_id, course_id)',
                { raw: true }
            );
        }
    } catch (e) {
        if (!(e.original && e.original.code === 'ER_NO_SUCH_TABLE')) {
            // Non-fatal: log and continue (e.g. permission or pre-existing dup-key edge cases)
            console.log(`   ⚠️  Could not ensure enrollments unique key: ${e.message}`);
        }
    }
}

/**
 * Upgrade existing `media` tables to unified schema (label, category, wider url/mime_type, indexes).
 * Idempotent — safe on every migrate-wp-to-ms run.
 */
async function ensureMediaTableSchema(tgt) {
    const alters = [
        'ALTER TABLE media ADD COLUMN label VARCHAR(128) NULL',
        "ALTER TABLE media ADD COLUMN category VARCHAR(64) NULL DEFAULT 'library'",
        'ALTER TABLE media MODIFY COLUMN url VARCHAR(512) NULL',
        'ALTER TABLE media MODIFY COLUMN mime_type VARCHAR(128) NULL',
    ];
    for (const sql of alters) {
        try {
            await tgt.query(sql, { raw: true });
        } catch (e) {
            if (e.original && e.original.code === 'ER_DUP_FIELDNAME') continue;
            if (e.message && e.message.includes('Duplicate column name')) continue;
            throw e;
        }
    }

    await tgt.query("UPDATE media SET category = 'library' WHERE category IS NULL", { raw: true });
    await tgt.query(`
      UPDATE media
      SET label = LEFT(title, 128)
      WHERE (label IS NULL OR TRIM(label) = '')
        AND title IS NOT NULL AND TRIM(title) != ''
    `, { raw: true });

    const indexes = [
        'CREATE INDEX idx_media_category ON media (category)',
        'CREATE INDEX idx_media_url ON media (url(191))',
    ];
    for (const sql of indexes) {
        try {
            await tgt.query(sql, { raw: true });
        } catch (e) {
            if (e.original && (e.original.code === 'ER_DUP_KEYNAME' || e.original.errno === 1061)) continue;
            if (e.message && (e.message.includes('Duplicate key name') || e.message.includes('already exists'))) continue;
            throw e;
        }
    }
}

/**
 * If an older deploy created `media_assets` (icon picker), merge into `media` and drop it.
 * Runs after WP media import; does not touch other modules.
 */
async function mergeLegacyMediaAssets(tgt) {
    // Check if legacy media_assets table exists on the target
    const [tableCheck] = await tgt.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_assets'",
        { raw: true },
    );
    if (!tableCheck || !tableCheck.length) return;

    console.log('🖼️  Merging legacy media_assets into media...');

    // Check if mime_type column exists on media_assets
    const [mimeCheck] = await tgt.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'media_assets' AND COLUMN_NAME = 'mime_type'`,
        { raw: true },
    );
    const mimeSelect = (mimeCheck && mimeCheck.length) ? 'ma.mime_type' : 'NULL';

    const [insert] = await tgt.query(`
      INSERT IGNORE INTO media (url, label, title, mime_type, category, created_at)
      SELECT ma.url, LEFT(ma.label, 128), LEFT(ma.label, 128), ${mimeSelect}, ma.category, ma.created_at
      FROM media_assets ma
      WHERE ma.url IS NOT NULL AND TRIM(ma.url) != ''
        AND NOT EXISTS (
          SELECT 1 FROM media m
          WHERE m.url = ma.url AND (m.category <=> ma.category)
        )
    `, { raw: true });

    await tgt.query('DROP TABLE media_assets', { raw: true });
    const n = insert?.affectedRows ?? 0;
    console.log(`   ✅ Merged ${n} row(s) from media_assets; table dropped`);
}

async function ensurePremiumPlansColumns(tgt) {
    // Safe ALTER TABLE patches — each is idempotent: silently skipped if column already exists.
    const alters = [
        // premium_plans
        "ALTER TABLE premium_plans ADD COLUMN slug VARCHAR(128) NULL AFTER name",
        "ALTER TABLE premium_plans ADD COLUMN description TEXT NULL AFTER slug",
        "ALTER TABLE premium_plans ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT 'INR' AFTER price",
        "ALTER TABLE premium_plans ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
        "ALTER TABLE premium_plans ADD COLUMN is_lifetime TINYINT(1) NOT NULL DEFAULT 0 AFTER duration_days",
        "ALTER TABLE premium_plans ADD COLUMN is_popular TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active",
        // courses
        "ALTER TABLE courses ADD COLUMN course_includes LONGTEXT NULL AFTER includes_info",
        "ALTER TABLE courses ADD COLUMN is_published TINYINT(1) NOT NULL DEFAULT 0",
        "ALTER TABLE courses ADD COLUMN affiliate_commission DECIMAL(10,2) NOT NULL DEFAULT 0",
        // users
        "ALTER TABLE users ADD COLUMN gst VARCHAR(100) NULL AFTER youtube",
        "ALTER TABLE users ADD COLUMN account_status VARCHAR(50) NULL AFTER gst",
        "ALTER TABLE users ADD COLUMN referral_code VARCHAR(32) UNIQUE",
        "ALTER TABLE users ADD COLUMN referred_by BIGINT UNSIGNED NULL",
        "ALTER TABLE users ADD COLUMN referred_at DATETIME NULL",
        // orders
        "ALTER TABLE orders ADD COLUMN original_amount DECIMAL(10,2) NULL",
        "ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(100) NULL",
        "ALTER TABLE orders ADD COLUMN coupon_discount DECIMAL(10,2) NULL DEFAULT 0",
        // payments
        "ALTER TABLE payments ADD COLUMN source VARCHAR(32) DEFAULT 'checkout'",
        "ALTER TABLE payments ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP",
        // coupons
        "ALTER TABLE coupons ADD COLUMN visibility ENUM('public','hidden') NOT NULL DEFAULT 'public'",
        "ALTER TABLE coupons ADD COLUMN usage_limit INT DEFAULT NULL",
        "ALTER TABLE coupons ADD COLUMN per_user_limit INT NOT NULL DEFAULT 1",
        // articles
        "ALTER TABLE articles ADD COLUMN blog_access_tier VARCHAR(20) NOT NULL DEFAULT 'free'",
        // payment_config
        "ALTER TABLE payment_config ADD COLUMN razorpay_key_id VARCHAR(255) NULL",
        "ALTER TABLE payment_config ADD COLUMN razorpay_key_secret VARCHAR(255) NULL",
    ];
    for (const sql of alters) {
        try {
            await tgt.query(sql, { raw: true });
        } catch (e) {
            // ER_DUP_FIELDNAME (1060): column already exists — safe to ignore
            if (e.original && e.original.code === 'ER_DUP_FIELDNAME') continue;
            if (e.message && e.message.includes('Duplicate column name')) continue;
            throw e;
        }
    }
}

// Tables managed via admin panel / other scripts — NEVER truncated by migration.
// Data you add through the admin panel or other scripts is preserved across runs.
const ADMIN_MANAGED_TABLES = new Set([
    // 'home_sections', 'faqs', 'testimonials', 'footer_data', 'states',
    // 'cms_pages', 'payment_config', 'admin_logs', 'batch_enrollments',
    // 'materials', 'outbox_events', 'payments', 'roles',
    // 'batches', 'sessions', 'recordings',
]);

/** Truncate only source-synced tables on target DB. Admin-managed tables are preserved. */
async function clearTargetDatabase(tgt) {
    const tables = [
        'withdrawal_requests', 'affiliate_balances', 'affiliate_history',
        'coupon_usages', 'plan_course_categories', 'plan_courses', 'premium_plans',
        'coupons', 'orders',
        'enrollments', 'course_authors', 'forum_topics', 'media', 'redirections', 'pages', 'file_categories', 'files',
        'file_cats', 'course_categories', 'course_cats', 'courses', 'comments', 'article_courts', 'article_types_map', 'article_tags',
        'article_categories', 'articles', 'courts', 'article_types', 'tags', 'categories', 'user_memberships', 'user_courses', 'users',
    ];
    await tgt.query('SET FOREIGN_KEY_CHECKS = 0', { raw: true });
    try {
        for (const table of tables) {
            if (ADMIN_MANAGED_TABLES.has(table)) continue;
            try {
                await tgt.query(`TRUNCATE TABLE \`${table}\``, { raw: true });
            } catch (e) {
                if (e.original && e.original.code === 'ER_NO_SUCH_TABLE') continue;
                throw e;
            }
        }
    } finally {
        await tgt.query('SET FOREIGN_KEY_CHECKS = 1', { raw: true });
    }
    console.log(`   ⏩ Preserved admin-managed tables: ${[...ADMIN_MANAGED_TABLES].join(', ')}`);
}

async function ensureDefaultRoles(tgt) {
    console.log('🛡️ Ensuring default roles...');
    const orderedRoles = ['super_admin', 'admin', 'user'];

    for (const roleName of orderedRoles) {
        await tgt.query(
            'INSERT INTO roles (name) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = ?)',
            { replacements: [roleName, roleName], raw: true }
        );
    }

    console.log(`   ✅ roles ensured: ${orderedRoles.join(', ')}`);
}

// ──────────── Migration functions ────────────

/** WP-migrated recordings default to visible unless explicitly hidden. */
function recordingIsVisibleFlag(r) {
    if (r.is_visible === 1 || r.is_visible === true) return 1;
    if (r.is_visible === 0 || r.is_visible === false) return 0;
    return 1;
}

const ARTICLE_UPSERT_TAIL = `
ON DUPLICATE KEY UPDATE
  wp_post_id=VALUES(wp_post_id), title=VALUES(title), slug=VALUES(slug), content=VALUES(content),
  excerpt=VALUES(excerpt), sub_heading=VALUES(sub_heading), author_id=VALUES(author_id),
  thumbnail_url=VALUES(thumbnail_url), views=VALUES(views), meta_title=VALUES(meta_title),
  meta_description=VALUES(meta_description), meta_keywords=VALUES(meta_keywords),
  case_name=VALUES(case_name), citation=VALUES(citation), appeal_number=VALUES(appeal_number),
  judgement_date=VALUES(judgement_date), assessment_year=VALUES(assessment_year),
  court_name=VALUES(court_name), section=VALUES(section), noti_no=VALUES(noti_no),
  noti_date=VALUES(noti_date), type_of_tax=VALUES(type_of_tax), ext_link=VALUES(ext_link), upload_url=VALUES(upload_url),
  rel_download_url=VALUES(rel_download_url), external_links=VALUES(external_links),
  status=VALUES(status), blog_access_tier=VALUES(blog_access_tier),
  published_at=VALUES(published_at), updated_at=VALUES(updated_at)`;

const COURSE_UPSERT_TAIL = `
ON DUPLICATE KEY UPDATE
  wp_post_id=VALUES(wp_post_id), title=VALUES(title), short_title=VALUES(short_title), slug=VALUES(slug),
  brief_description=VALUES(brief_description), description=VALUES(description), curriculum=VALUES(curriculum),
  learn_outcomes=VALUES(learn_outcomes), requirements=VALUES(requirements), terms_conditions=VALUES(terms_conditions),
  price=VALUES(price), sale_price=VALUES(sale_price), enrolled_count=VALUES(enrolled_count),
  ratings=VALUES(ratings), rating_users=VALUES(rating_users), thumbnail_url=VALUES(thumbnail_url),
  youtube_url=VALUES(youtube_url), language=VALUES(language), course_type=VALUES(course_type),
  taxable=VALUES(taxable), keywords=VALUES(keywords),
  meta_title=VALUES(meta_title), meta_description=VALUES(meta_description), meta_keywords=VALUES(meta_keywords),
  canonical_url=VALUES(canonical_url), robots=VALUES(robots), og_title=VALUES(og_title),
  og_description=VALUES(og_description), og_image_url=VALUES(og_image_url),
  faqs=VALUES(faqs), feedback=VALUES(feedback),
  includes_info=VALUES(includes_info), course_includes=VALUES(course_includes),
  certifications=VALUES(certifications), gateway=VALUES(gateway),
  is_published=VALUES(is_published), status=VALUES(status),
  start_date=VALUES(start_date), end_date=VALUES(end_date), updated_at=VALUES(updated_at)`;

async function migrateUsers(src, tgt) {
    console.log('👤 Migrating users...');
    const total = await src.query(`SELECT COUNT(*) as c FROM \`${_srcUsersTable}\``, { type: QueryTypes.SELECT });
    console.log(`   Source: ${total[0].c} users`);

    // Get WP password hashes
    const passwords = {};
    const wpPasswords = await src.query('SELECT ID, user_pass FROM deepak_users', { type: QueryTypes.SELECT });
    wpPasswords.forEach(u => { passwords[u.ID] = u.user_pass; });

    const allUsers = await src.query(`SELECT * FROM \`${_srcUsersTable}\` ORDER BY id`, { type: QueryTypes.SELECT });
    const userRole = await tgt.query("SELECT id FROM roles WHERE name = 'user' LIMIT 1", { type: QueryTypes.SELECT });
    if (!userRole.length) {
        throw new Error("Role 'user' not found in target roles table");
    }
    const defaultUserRoleId = userRole[0].id;

    // Truncate target
    await tgt.query('DELETE FROM user_courses', { raw: true });
    await tgt.query('DELETE FROM user_memberships', { raw: true });
    await tgt.query('DELETE FROM users', { raw: true });

    for (let i = 0; i < allUsers.length; i += BATCH) {
        const chunk = allUsers.slice(i, i + BATCH);
        const values = chunk.map(u => {
            const { id: msId, wpRefSql } = msWpEntityIdExpr(u, 'wp_user_id');
            const passHash = passwords[msId] || passwords[u.wp_user_id] || null;
            const email = u.email || `wp_${msId}@placeholder.studycafe.in`;
            const membership = normalizeMembershipSlug(u.membership);
            const createdAt = escDate(u.created_at);
            return `(${msId}, ${wpRefSql}, ${esc(email)}, ${esc(passHash)}, ${esc(u.display_name)}, ${esc(u.display_name)}, ${esc(u.login)}, ${esc(u.first_name)}, ${esc(u.last_name)}, ${esc(u.user_nicename)}, ${esc(u.user_url)}, ${esc(u.phone)}, ${esc(u.profession)}, ${esc(u.designation)}, ${esc(u.company)}, ${esc(u.city)}, ${esc(u.state)}, ${esc(u.country)}, ${escUploadUrl(u.profile_pic_url)}, ${esc(membership)}, ${esc(u.plan)}, ${defaultUserRoleId}, 'user', 1, ${esc(u.status)}, ${esc(u.facebook)}, ${esc(u.twitter)}, ${esc(u.linkedin)}, ${esc(u.instagram)}, ${esc(u.youtube)}, ${esc(u.gst)}, ${esc(u.account_status)}, ${esc(u.bio)}, ${createdAt}, ${createdAt}, ${createdAt})`;
        }).join(',');
        await tgt.query(`INSERT INTO users (id, wp_user_id, email, password_hash, name, display_name, login, first_name, last_name, user_nicename, user_url, phone, profession, designation, company, city, state, country, profile_pic_url, membership, plan, role_id, role, is_active, status, facebook, twitter, linkedin, instagram, youtube, gst, account_status, bio, created_at, updated_at, email_verified_at) VALUES ${values}
        ON DUPLICATE KEY UPDATE
          wp_user_id=VALUES(wp_user_id), email=VALUES(email), password_hash=VALUES(password_hash),
          name=VALUES(name), display_name=VALUES(display_name), login=VALUES(login),
          first_name=VALUES(first_name), last_name=VALUES(last_name), phone=VALUES(phone),
          membership=VALUES(membership), plan=VALUES(plan), status=VALUES(status),
          email_verified_at=COALESCE(email_verified_at, VALUES(email_verified_at)),
          updated_at=VALUES(updated_at)`, { raw: true });
        process.stdout.write(`   ${Math.min(i + BATCH, allUsers.length)}/${allUsers.length}\r`);
    }
    if (allUsers.length) {
        const nextAi = await bumpTableAutoIncrement(tgt, 'users');
        console.log(`   🔢 users AUTO_INCREMENT → ${nextAi} (new rows omit id; wp_user_id NULL)`);
    }
    await tgt.query(
        `UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at, NOW())
         WHERE wp_user_id IS NOT NULL AND email_verified_at IS NULL`,
        { raw: true }
    );
    console.log(`   ✅ ${allUsers.length} users migrated (default role: user, legacy accounts email-verified)`);
}

/**
 * Populate user_memberships from sc_users.membership + sc_users.plan (JSON).
 * WP stored plan as usermeta 'plan' with plan_purchased, plan_expiry, payment_id;
 * the data-migration project copies that into sc_users.plan (TEXT).
 * Legacy WP membership slugs are normalized: advanced→premium, premium→ultimate.
 */
async function migrateUserMemberships(src, tgt) {
    console.log('🎫 Migrating user memberships...');
    const userIdMap = await buildScUserIdMap(src);
    const mapUid = (id) => userIdMap[id] ?? id;
    const users = await src.query(
        `SELECT id, membership, plan, created_at FROM \`${_srcUsersTable}\` WHERE (plan IS NOT NULL AND plan != "" AND plan != "null") OR (membership IS NOT NULL AND membership != "" AND membership != "free")`,
        { type: QueryTypes.SELECT }
    );
    if (!users.length) {
        console.log('   ✅ 0 user memberships (no plan/membership data)');
        return;
    }
    let inserted = 0;
    let skipped = 0;
    for (const u of users) {
        let start = null;
        let end = null;
        let orderId = null;
        if (u.plan) {
            try {
                const p = typeof u.plan === 'string' ? JSON.parse(u.plan) : u.plan;
                if (p && (p.plan_purchased || p.plan_expiry)) {
                    start = p.plan_purchased ? new Date(p.plan_purchased) : null;
                    end = p.plan_expiry ? new Date(p.plan_expiry) : null;
                    orderId = p.payment_id || p.order_id || null;
                }
            } catch (_) {
                skipped++;
                continue;
            }
        }
        const membershipType = (u.membership && String(u.membership).trim() && String(u.membership).toLowerCase() !== 'free')
            ? normalizeMembershipSlug(u.membership)
            : 'free';
        if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
            if (membershipType === 'free') {
                skipped++;
                continue;
            }
            const created = u.created_at ? new Date(u.created_at) : new Date();
            start = start || created;
            end = end || new Date(created.getTime() + 365 * 24 * 60 * 60 * 1000);
        }
        try {
            await tgt.query(
                `INSERT INTO user_memberships (user_id, membership_type, order_id, starts_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
                { replacements: [mapUid(u.id), membershipType, orderId, start, end], raw: true }
            );
            inserted++;
        } catch (err) {
            if (err.message && err.message.includes('Duplicate')) {
                skipped++;
            } else {
                throw err;
            }
        }
        if ((inserted + skipped) % 500 === 0) process.stdout.write(`   ${inserted} memberships inserted, ${skipped} skipped\r`);
    }
    console.log(`   ✅ ${inserted} user memberships migrated (${skipped} skipped)`);
}

/**
 * Migrate premium_plans (membership plan definitions) from source.
 * Priority: 1) WordPress postmeta on Membership Plans page (post 103370) — all 3 plans;
 *          2) sc_courses with "Join Studycafe Lifetime Ultimate/Premium" (fallback);
 *          3) source premium_plans table; 4) sc_payments.
 * WP postmeta uses legacy keys (premium_* = Ultimate, advanced_* = Premium); merged rows
 * from source tables are normalized via normalizePlanRecord().
 */
async function migratePremiumPlans(src, tgt) {
    console.log('📋 Migrating premium plans...');
    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('premium_plans', 'sc_courses', 'sc_payments', 'deepak_postmeta')",
        { type: QueryTypes.SELECT }
    );
    const hasDeepakPostmeta = tables.some(t => t.TABLE_NAME === 'deepak_postmeta');
    const hasPremiumPlans = tables.some(t => t.TABLE_NAME === 'premium_plans');
    const hasScCourses = tables.some(t => t.TABLE_NAME === 'sc_courses');
    const hasScPayments = tables.some(t => t.TABLE_NAME === 'sc_payments');

    await tgt.query('DELETE FROM premium_plans', { raw: true });
    const insertedSlugs = new Set();
    let sortOrder = 0;

    /** Strip HTML tags for clean feature strings */
    function stripHtml(html) {
        if (!html) return '';
        return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#8211;/g, '–').replace(/&#8217;/g, "'").trim();
    }

    /** Parse newline-separated features from WP postmeta into JSON array */
    function parseFeatures(raw) {
        if (!raw) return [];
        return raw.split('\n').map(l => stripHtml(l).trim()).filter(Boolean);
    }

    // ─── 1) PRIMARY: Read all 3 plans from WP Membership Plans page (post 103370) ───
    if (hasDeepakPostmeta) {
        const PLANS_PAGE_ID = 103370;
        const metaRows = await src.query(
            `SELECT meta_key, meta_value FROM deepak_postmeta WHERE post_id = ? AND meta_key IN (
                'premium_mrp','premium_price','premium_features',
                'advanced_mrp','advanced_price','advanced_features','advanced_features_not',
                'basic_mrp','basic_price','basic_features','basic_features_not'
            )`,
            { replacements: [PLANS_PAGE_ID], type: QueryTypes.SELECT }
        );
        if (metaRows.length > 0) {
            const meta = {};
            metaRows.forEach(r => { meta[r.meta_key] = r.meta_value; });

            // Plan definitions: [slug, displayName, metaPrefix, duration, isLifetime, isPopular, includedFeatures, excludedFeatures]
            const planDefs = [
                { slug: 'ultimate', name: 'Ultimate', prefix: 'premium', durationDays: 3650, isLifetime: 1, isPopular: 1 },
                { slug: 'premium',  name: 'Premium',  prefix: 'advanced', durationDays: 3650, isLifetime: 1, isPopular: 0 },
                { slug: 'basic',    name: 'Basic',     prefix: 'basic',    durationDays: 365,  isLifetime: 0, isPopular: 0 },
            ];

            for (const plan of planDefs) {
                const price = parseFloat(meta[`${plan.prefix}_price`]) || 0;
                const mrp = parseFloat(meta[`${plan.prefix}_mrp`]) || 0;
                const features = parseFeatures(meta[`${plan.prefix}_features`]);
                const excludedFeatures = parseFeatures(meta[`${plan.prefix}_features_not`]);
                const featuresJson = JSON.stringify({ included: features, excluded: excludedFeatures, mrp });

                if (price > 0 || features.length > 0) {
                    await tgt.query(
                        `INSERT INTO premium_plans (name, slug, description, price, currency, duration_days, is_lifetime, features, sort_order, is_active, is_popular)
                         VALUES (?, ?, NULL, ?, 'INR', ?, ?, ?, ?, 1, ?)`,
                        { replacements: [plan.name, plan.slug, price, plan.durationDays, plan.isLifetime, featuresJson, sortOrder++, plan.isPopular], raw: true }
                    );
                    insertedSlugs.add(plan.slug);
                }
            }
            if (insertedSlugs.size > 0) {
                console.log(`   ✅ ${insertedSlugs.size} plans from WP Membership Plans page (post ${PLANS_PAGE_ID})`);
            }
        }
    }

    // ─── 2) Fallback: sc_courses with Lifetime Ultimate/Premium ───
    if (insertedSlugs.size === 0 && hasScCourses) {
        const rows = await src.query(
            `SELECT id, wp_post_id, title, slug, brief_description, description, price, sale_price, includes_info
             FROM sc_courses
             WHERE (title LIKE '%Lifetime Ultimate%' OR title LIKE '%Lifetime Premium%' OR (title LIKE '%Ultimate%' AND title LIKE '%Membership%') OR (title LIKE '%Premium%' AND title LIKE '%Membership%'))
               AND title NOT LIKE 'DUP %'
             ORDER BY sale_price DESC`,
            { type: QueryTypes.SELECT }
        );
        const byTier = {};
        for (const r of rows || []) {
            const lower = (r.title && String(r.title).toLowerCase()) || '';
            const isUltimate = lower.includes('ultimate');
            const isPremium = lower.includes('premium') && !lower.includes('ultimate');
            const tier = isUltimate ? 'ultimate' : (isPremium ? 'premium' : null);
            if (!tier || byTier[tier]) continue;
            byTier[tier] = r;
        }
        for (const tier of ['ultimate', 'premium']) {
            const r = byTier[tier];
            if (!r) continue;
            const name = tier === 'ultimate' ? 'Ultimate' : 'Premium';
            const desc = (r.brief_description && String(r.brief_description).trim()) ? r.brief_description : (r.description ? String(r.description).substring(0, 2000) : null);
            const priceVal = r.sale_price != null ? Number(r.sale_price) : (r.price != null ? Number(r.price) : 0);
            let featuresJson = '[]';
            if (r.includes_info) {
                try {
                    const parsed = typeof r.includes_info === 'string' ? JSON.parse(r.includes_info) : r.includes_info;
                    const arr = Array.isArray(parsed) ? parsed : (parsed && parsed.length ? [parsed] : []);
                    const titles = arr.map((x) => (x && (x.title || x.name)) ? String(x.title || x.name).trim() : null).filter(Boolean);
                    featuresJson = JSON.stringify(titles.length ? titles : []);
                } catch (_) { }
            }
            await tgt.query(
                `INSERT INTO premium_plans (name, slug, description, price, currency, duration_days, is_lifetime, features, sort_order, is_active)
                 VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, 1)`,
                { replacements: [name, tier, desc, priceVal, 3650, 1, featuresJson, sortOrder++], raw: true }
            );
            insertedSlugs.add(tier);
        }
        if (insertedSlugs.size > 0) {
            console.log(`   ✅ ${insertedSlugs.size} plans from sc_courses (Lifetime Ultimate/Premium)`);
        }
    }

    // ─── 3) Merge from source premium_plans for any missing slugs ───
    if (hasPremiumPlans) {
        const rows = await src.query('SELECT id, name, slug, description, price, currency, duration_days, features, sort_order, is_active FROM premium_plans ORDER BY sort_order, id', { type: QueryTypes.SELECT });
        let merged = 0;
        for (const r of rows || []) {
            const rawSlug = (r.slug != null && String(r.slug).trim() !== '') ? String(r.slug).trim().toLowerCase().substring(0, 128) : (r.name ? slugify(r.name) : null);
            const { name: planName, slug } = normalizePlanRecord(r.name, rawSlug);
            if (!slug || insertedSlugs.has(slug)) continue;
            const features = (r.features != null && typeof r.features === 'string') ? r.features : (r.features != null ? JSON.stringify(r.features) : '[]');
            await tgt.query(
                `INSERT INTO premium_plans (name, slug, description, price, currency, duration_days, is_lifetime, features, sort_order, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                {
                    replacements: [
                        planName, slug, r.description || null, r.price ?? 0,
                        r.currency || 'INR', r.duration_days ?? 365,
                        (r.duration_days != null && Number(r.duration_days) >= 3650) ? 1 : 0,
                        features, sortOrder++, r.is_active != null ? (r.is_active ? 1 : 0) : 1,
                    ],
                    raw: true,
                }
            );
            insertedSlugs.add(slug);
            merged++;
        }
        if (merged > 0) console.log(`   ✅ Merged ${merged} from source premium_plans`);
    }

    if (insertedSlugs.size > 0) {
        console.log(`   ✅ Total ${insertedSlugs.size} premium plans`);
        return;
    }

    // ─── 4) Last fallback: sc_payments ───
    if (hasScPayments) {
        const rows = await src.query('SELECT id, wp_post_id, title, amount, price, total_seats, seats_booked, expiry, status, created_at FROM sc_payments ORDER BY id', { type: QueryTypes.SELECT });
        if (rows.length > 0) {
            for (const r of rows) {
                const rawName = (r.title && String(r.title).trim()) ? String(r.title).trim().substring(0, 255) : `Plan ${r.id}`;
                const rawSlug = slugify(rawName) || `plan-${r.id}`;
                const { name, slug } = normalizePlanRecord(rawName, rawSlug);
                const priceVal = r.price != null ? Number(r.price) : (r.amount != null ? Number(r.amount) : 0);
                let durationDays = 365;
                if (r.expiry && r.created_at) {
                    const created = new Date(r.created_at);
                    const expiry = new Date(r.expiry);
                    if (!isNaN(expiry.getTime()) && !isNaN(created.getTime())) {
                        durationDays = Math.max(1, Math.round((expiry - created) / (24 * 60 * 60 * 1000)));
                    }
                }
                await tgt.query(
                    `INSERT INTO premium_plans (name, slug, description, price, currency, duration_days, is_lifetime, features, sort_order, is_active)
                     VALUES (?, ?, NULL, ?, 'INR', ?, ?, '[]', ?, 1)`,
                    { replacements: [name, slug.substring(0, 128), priceVal, durationDays, durationDays >= 3650 ? 1 : 0, sortOrder++], raw: true }
                );
            }
            console.log(`   ✅ ${rows.length} premium plans from source sc_payments`);
            return;
        }
    }

    console.log('   ⏭️ No source premium_plans, WP postmeta, sc_courses, or sc_payments; skip.');
}

function slugify(text) {
    return (text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 128) || null;
}

/**
 * WordPress stored legacy tier keys in usermeta / sc_users.membership:
 *   advanced (Advance Plan) → premium (Premium)
 *   premium  (Premium Plan) → ultimate (Ultimate)
 * basic and free are unchanged.
 */
function normalizeMembershipSlug(raw) {
    if (raw == null || raw === '') return raw;
    const s = String(raw).trim().toLowerCase();
    if (s === 'free') return 'free';
    if (s === 'advanced' || s === 'advance') return 'premium';
    if (s === 'premium') return 'ultimate';
    return String(raw).trim().substring(0, 64);
}

/** Normalize legacy WP plan slug/name to post-rebrand premium_plans values. */
function normalizePlanRecord(name, slug) {
    const s = slug ? String(slug).trim().toLowerCase().substring(0, 128) : (name ? slugify(name) : null);
    if (s === 'advanced' || s === 'advance') return { name: 'Premium', slug: 'premium' };
    if (s === 'premium') return { name: 'Ultimate', slug: 'ultimate' };
    if (s === 'ultimate') return { name: 'Ultimate', slug: 'ultimate' };
    if (s === 'basic') return { name: 'Basic', slug: 'basic' };

    const n = (name || '').trim().toLowerCase();
    if (n === 'advanced' || n === 'advance' || n.includes('advance plan') || n.includes('advanced plan') || n.includes('advanced membership')) {
        return { name: 'Premium', slug: 'premium' };
    }
    if (n.includes('ultimate')) return { name: 'Ultimate', slug: 'ultimate' };
    if (n === 'premium' || n === 'premium plan' || n === 'premium membership' || (n.includes('premium') && n.includes('membership'))) {
        return { name: 'Ultimate', slug: 'ultimate' };
    }
    if (n === 'basic' || n.includes('basic plan')) return { name: 'Basic', slug: 'basic' };

    return { name: (name && String(name).trim()) || 'Plan', slug: s || slugify(name) || 'plan' };
}

/** Parse PHP serialized array of IDs: e.g. a:2:{i:0;i:123;i:1;i:456;} or a:1:{i:0;s:4:"1234";} → [123, 456] */
function parsePhpIntArray(val) {
    if (!val || typeof val !== 'string') return [];
    const ids = [];
    let m;
    const intRe = /i:(\d+);/g;
    while ((m = intRe.exec(val))) ids.push(parseInt(m[1], 10));
    if (ids.length > 0) return ids;
    const strRe = /s:\d+:"(\d+)"/g;
    while ((m = strRe.exec(val))) ids.push(parseInt(m[1], 10));
    return ids;
}

/**
 * Map a WordPress course `type` (sc_courses.course_type) to the membership tier
 * that includes it, after the StudyCafe rebrand:
 *   WP type 'Basic'    → tier 'basic'
 *   WP type 'Advanced' → tier 'premium'   (advanced was rebranded to premium)
 *   WP type 'Premium'  → tier 'ultimate'  (premium was rebranded to ultimate)
 *   WP type 'Paid'     → individually purchased only (no membership)
 *   '', null, 'Free'   → free (no membership)
 */
function courseTypeToTier(courseType) {
    const t = String(courseType || '').trim().toLowerCase();
    if (t === 'basic') return 'basic';
    if (t === 'advanced' || t === 'advance') return 'premium';
    if (t === 'premium') return 'ultimate';
    return null; // paid / free / unknown → not part of any membership
}

/**
 * Ensure the three canonical membership tier plans exist (basic, premium, ultimate)
 * with a tier_rank for upgrade ordering. Existing rows are left untouched.
 */
async function ensureTierPlans(tgt) {
    // tier_rank may not exist on very old DBs; ensurePremiumPlansColumns() adds it.
    const TIERS = [
        { slug: 'basic', name: 'Basic', rank: 1, duration: 365, lifetime: 0 },
        { slug: 'premium', name: 'Premium', rank: 2, duration: 3650, lifetime: 1 },
        { slug: 'ultimate', name: 'Ultimate', rank: 3, duration: 3650, lifetime: 1 },
    ];
    const existing = await tgt.query('SELECT slug FROM premium_plans', { type: QueryTypes.SELECT });
    const have = new Set((existing || []).map((p) => String(p.slug || '').toLowerCase()));
    let sortOrder = (existing || []).length;
    for (const t of TIERS) {
        if (have.has(t.slug)) continue;
        try {
            await tgt.query(
                `INSERT INTO premium_plans (name, slug, description, price, currency, duration_days, is_lifetime, features, sort_order, is_active, tier_rank)
                 VALUES (?, ?, NULL, 0, 'INR', ?, ?, '[]', ?, 1, ?)`,
                { replacements: [t.name, t.slug, t.duration, t.lifetime, sortOrder++, t.rank], raw: true }
            );
            console.log(`   + created missing tier plan '${t.slug}'`);
        } catch (e) {
            // tier_rank column might be absent on a very old DB; retry without it.
            if (e.message && /tier_rank/.test(e.message)) {
                await tgt.query(
                    `INSERT INTO premium_plans (name, slug, description, price, currency, duration_days, is_lifetime, features, sort_order, is_active)
                     VALUES (?, ?, NULL, 0, 'INR', ?, ?, '[]', ?, 1)`,
                    { replacements: [t.name, t.slug, t.duration, t.lifetime, sortOrder++], raw: true }
                );
            } else if (!(e.message && e.message.includes('Duplicate'))) {
                throw e;
            }
        }
    }
}

/**
 * Migrate plan_courses: which courses are included in each membership plan.
 *
 * StudyCafe membership access is TIER-BASED on each course's `type`, not on a
 * per-plan course list (the legacy `rel_course` meta is effectively unused — only
 * a handful of non-empty rows). Each course is tagged Basic/Advanced/Premium and
 * a membership unlocks all courses at-or-below its tier:
 *   basic    → Basic courses
 *   premium  → Basic + Advanced courses
 *   ultimate → Basic + Advanced + Premium courses
 * This rebuilds plan_courses from sc_courses.course_type so every tier (including
 * Basic) gets the correct, complete course set.
 */
async function migratePlanCourses(src, tgt) {
    console.log('🔗 Migrating plan–course relations (tier-based)...');
    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sc_courses'",
        { type: QueryTypes.SELECT }
    );
    if (!tables.length) {
        console.log('   ⏭️ No sc_courses; skip.');
        return;
    }

    // Guarantee the three canonical tier plans exist (so every tier, incl. Basic,
    // can be linked even if a source plan definition was missing).
    await ensureTierPlans(tgt);

    const planRows = await tgt.query('SELECT id, slug FROM premium_plans', { type: QueryTypes.SELECT });
    const slugToPlanId = {};
    (planRows || []).forEach((p) => { slugToPlanId[String(p.slug || '').toLowerCase()] = p.id; });

    // Tier hierarchy: each plan includes its own tier + all lower tiers.
    const TIER_INCLUDES = {
        basic: ['basic'],
        premium: ['basic', 'premium'],
        ultimate: ['basic', 'premium', 'ultimate'],
    };

    // Resolve source course id → target course id (via wp_post_id, then sc id).
    const courseRows = await tgt.query('SELECT id, wp_post_id FROM courses', { type: QueryTypes.SELECT });
    const wpPostIdToCourseId = {};
    const courseIdSet = new Set();
    (courseRows || []).forEach((c) => {
        courseIdSet.add(Number(c.id));
        if (c.wp_post_id != null) wpPostIdToCourseId[Number(c.wp_post_id)] = c.id;
    });

    // Group source courses by tier.
    const scCourses = await src.query('SELECT id, wp_post_id, course_type, title FROM sc_courses', { type: QueryTypes.SELECT });
    const coursesByTier = { basic: [], premium: [], ultimate: [] };
    for (const c of scCourses) {
        // Skip membership product posts themselves (they are not learning courses).
        const title = String(c.title || '');
        if (/^DUP /i.test(title)) continue;
        if (/membership plan/i.test(title)) continue;
        const tier = courseTypeToTier(c.course_type);
        if (!tier) continue;
        const targetCourseId = (c.wp_post_id != null && wpPostIdToCourseId[Number(c.wp_post_id)]) || (courseIdSet.has(Number(c.id)) ? Number(c.id) : null);
        if (!targetCourseId) continue;
        coursesByTier[tier].push(targetCourseId);
    }

    await tgt.query('DELETE FROM plan_courses', { raw: true });

    let inserted = 0;
    for (const [slug, includedTiers] of Object.entries(TIER_INCLUDES)) {
        const planId = slugToPlanId[slug];
        if (!planId) {
            console.log(`   ⚠️  No premium_plans row for slug '${slug}'; skipping its course links.`);
            continue;
        }
        const courseIds = new Set();
        includedTiers.forEach((t) => coursesByTier[t].forEach((cid) => courseIds.add(cid)));
        if (courseIds.size === 0) continue;
        const values = [...courseIds].map((cid) => `(${planId}, ${cid})`).join(',');
        await tgt.query(`INSERT IGNORE INTO plan_courses (plan_id, course_id) VALUES ${values}`, { raw: true });
        inserted += courseIds.size;
        console.log(`   plan '${slug}' (#${planId}): ${courseIds.size} courses`);
    }
    console.log(`   ✅ ${inserted} plan–course links (tier-based)`);
}

async function migrateCategories(src, tgt) {
    console.log('📁 Migrating categories...');
    const rows = await src.query('SELECT * FROM sc_categories ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_categories', { raw: true });
    await tgt.query('DELETE FROM categories', { raw: true });
    if (!rows.length) return;
    const parentIdMap = await buildScWpPostIdMap(src, 'sc_categories', 'wp_term_id');
    const mapPid = (id) => (id != null && id !== '' ? (parentIdMap[id] ?? id) : null);
    const values = rows.map(r => {
        const { id: msId, wpRefSql } = msWpEntityIdExpr(r, 'wp_term_id');
        const parentId = mapPid(r.parent_id);
        return `(${msId}, ${wpRefSql}, ${esc(r.name)}, ${esc(r.slug)}, ${parentId || 'NULL'}, ${esc(r.description)}, ${escUploadUrl(r.image_url)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO categories (id, wp_term_id, name, slug, parent_id, description, image_url) VALUES ${values}`, { raw: true });
    const nextAi = await bumpTableAutoIncrement(tgt, 'categories');
    console.log(`   🔢 categories AUTO_INCREMENT → ${nextAi}`);
    console.log(`   ✅ ${rows.length} categories`);
}

async function migrateTags(src, tgt) {
    console.log('🏷️  Migrating tags...');
    const rows = await src.query('SELECT * FROM sc_tags ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_tags', { raw: true });
    await tgt.query('DELETE FROM tags', { raw: true });
    if (!rows.length) return;
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(r => {
            const { id: msId, wpRefSql } = msWpEntityIdExpr(r, 'wp_term_id');
            return `(${msId}, ${wpRefSql}, ${esc(r.name)}, ${esc(r.slug)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO tags (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    }
    const nextAi = await bumpTableAutoIncrement(tgt, 'tags');
    console.log(`   🔢 tags AUTO_INCREMENT → ${nextAi}`);
    console.log(`   ✅ ${rows.length} tags`);
}

async function migrateArticleTypes(src, tgt) {
    console.log('📋 Migrating article types...');
    const rows = await src.query('SELECT * FROM sc_article_types ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_types_map', { raw: true });
    await tgt.query('DELETE FROM article_types', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => {
        const { id: msId, wpRefSql } = msWpEntityIdExpr(r, 'wp_term_id');
        return `(${msId}, ${wpRefSql}, ${esc(r.name)}, ${esc(r.slug)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO article_types (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    const nextAi = await bumpTableAutoIncrement(tgt, 'article_types');
    console.log(`   🔢 article_types AUTO_INCREMENT → ${nextAi}`);
    console.log(`   ✅ ${rows.length} article types`);
}

async function migrateCourts(src, tgt) {
    console.log('⚖️  Migrating courts...');
    const rows = await src.query('SELECT * FROM sc_courts ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_courts', { raw: true });
    await tgt.query('DELETE FROM courts', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => {
        const { id: msId, wpRefSql } = msWpEntityIdExpr(r, 'wp_term_id');
        return `(${msId}, ${wpRefSql}, ${esc(r.name)}, ${esc(r.slug)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO courts (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    const nextAi = await bumpTableAutoIncrement(tgt, 'courts');
    console.log(`   🔢 courts AUTO_INCREMENT → ${nextAi}`);
    console.log(`   ✅ ${rows.length} courts`);
}

async function migrateCourseCats(src, tgt) {
    console.log('📚 Migrating course cats...');
    const rows = await src.query('SELECT * FROM sc_course_cats ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM course_categories', { raw: true });
    await tgt.query('DELETE FROM course_cats', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => {
        const { id: msId, wpRefSql } = msWpEntityIdExpr(r, 'wp_term_id');
        return `(${msId}, ${wpRefSql}, ${esc(r.name)}, ${esc(r.slug)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO course_cats (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    const nextAi = await bumpTableAutoIncrement(tgt, 'course_cats');
    console.log(`   🔢 course_cats AUTO_INCREMENT → ${nextAi}`);
    console.log(`   ✅ ${rows.length} course cats`);
}

async function migrateFileCats(src, tgt) {
    console.log('📂 Migrating file cats...');
    try {
        const rows = await src.query('SELECT * FROM sc_file_cats ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM file_categories', { raw: true });
        await tgt.query('DELETE FROM file_cats', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 file cats'); return; }
        const values = rows.map(r => {
            const { id: msId, wpRefSql } = msWpEntityIdExpr(r, 'wp_term_id');
            return `(${msId}, ${wpRefSql}, ${esc(r.name)}, ${esc(r.slug)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO file_cats (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
        const nextAi = await bumpTableAutoIncrement(tgt, 'file_cats');
        console.log(`   🔢 file_cats AUTO_INCREMENT → ${nextAi}`);
        console.log(`   ✅ ${rows.length} file cats`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_file_cats not in source, skip'); return; }
        throw e;
    }
}

/**
 * Migrated WP rows use id = wp_* ref (wp_post_id, wp_user_id, wp_term_id, wp_comment_id).
 * Rows without wp_* ref keep surrogate sc_* id and wp_* NULL; AUTO_INCREMENT continues after MAX(id).
 */
function msWpEntityIdExpr(row, wpField = 'wp_post_id') {
    const wpRaw = row[wpField];
    const wp = wpRaw != null && wpRaw !== '' ? Number(wpRaw) : null;
    if (wp != null && Number.isFinite(wp) && wp > 0) {
        return { id: wp, wpRefSql: String(wp) };
    }
    return { id: Number(row.id), wpRefSql: 'NULL' };
}

function msArticleIdAndWpPostExprFromScRow(a) {
    const { id, wpRefSql } = msWpEntityIdExpr(a, 'wp_post_id');
    return { id, wpPostIdSql: wpRefSql };
}

function msWpCommentIdExpr(c) {
    const { id, wpRefSql } = msWpEntityIdExpr(c, 'wp_comment_id');
    return { id, wpCommentIdSql: wpRefSql };
}

async function bumpTableAutoIncrement(tgt, table) {
    const [mx] = await tgt.query(`SELECT IFNULL(MAX(id), 0) AS m FROM \`${table}\``, { type: QueryTypes.SELECT });
    const nextAi = Number(mx.m) + 1;
    await tgt.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${nextAi}`, { raw: true });
    return nextAi;
}

/** sc_*.id (snapshot PK) → production id (WP post/comment id when wp_* column present). */
async function buildScWpPostIdMap(src, table, wpField = 'wp_post_id') {
    const rows = await src.query(`SELECT id, \`${wpField}\` AS wp_ref FROM \`${table}\``, { type: QueryTypes.SELECT });
    const map = Object.create(null);
    for (const row of rows || []) {
        const wp = row.wp_ref != null && row.wp_ref !== '' ? Number(row.wp_ref) : null;
        map[row.id] = wp != null && Number.isFinite(wp) && wp > 0 ? wp : Number(row.id);
    }
    return map;
}

/** sc_articles.id (snapshot PK) → articles.id in target (WP post id when present). */
async function buildScArticleSurrogateToMsArticleIdMap(src) {
    return buildScWpPostIdMap(src, 'sc_articles', 'wp_post_id');
}

/** sc_users.id (snapshot PK) → users.id in target (WP user id when present). */
async function buildScUserIdMap(src) {
    return buildScWpPostIdMap(src, _srcUsersTable, 'wp_user_id');
}

async function migrateArticles(src, tgt) {
    console.log('📰 Migrating articles...');
    const total = await src.query('SELECT COUNT(*) as c FROM sc_articles', { type: QueryTypes.SELECT });
    console.log(`   Source: ${total[0].c} articles`);

    const allArticles = await src.query('SELECT * FROM sc_articles ORDER BY id', { type: QueryTypes.SELECT });
    const userIdMap = await buildScUserIdMap(src);
    const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);

    for (let i = 0; i < allArticles.length; i += BATCH) {
        const chunk = allArticles.slice(i, i + BATCH);
        const values = chunk.map(a => {
            const accessTier = esc(a.blog_access_tier || 'free');
            const { id: msId, wpPostIdSql } = msArticleIdAndWpPostExprFromScRow(a);
            const viewsVal = a.views != null && a.views !== '' ? Number(a.views) || 0 : 0;
            const authorId = mapUid(a.author_id);
            return `(${msId}, ${wpPostIdSql}, ${esc(a.title, 65535)}, ${esc(a.slug)}, ${escUploadContent(a.content, 16000000)}, ${esc(a.excerpt, 65535)}, ${esc(a.sub_heading)}, ${authorId || 'NULL'}, ${escUploadUrl(a.thumbnail_url)}, ${viewsVal}, ${esc(a.meta_title)}, ${esc(a.meta_description)}, ${esc(a.meta_keywords)}, ${esc(a.case_name)}, ${esc(a.citation)}, ${esc(a.appeal_number)}, ${esc(a.judgement_date)}, ${esc(a.assessment_year)}, ${esc(a.court_name)}, ${esc(a.section)}, ${esc(a.noti_no)}, ${esc(a.noti_date)}, ${esc(a.type_of_tax)}, ${esc(a.ext_link)}, ${escUploadUrl(a.upload_url)}, ${escUploadUrl(a.rel_download_url)}, ${esc(a.external_links)}, ${esc(a.status)}, ${accessTier}, ${escDate(a.published_at)}, ${escDate(a.created_at)}, ${escDate(a.updated_at)})`;
        }).join(',');
        await tgt.query(`INSERT INTO articles (id, wp_post_id, title, slug, content, excerpt, sub_heading, author_id, thumbnail_url, views, meta_title, meta_description, meta_keywords, case_name, citation, appeal_number, judgement_date, assessment_year, court_name, section, noti_no, noti_date, type_of_tax, ext_link, upload_url, rel_download_url, external_links, status, blog_access_tier, published_at, created_at, updated_at) VALUES ${values}${ARTICLE_UPSERT_TAIL}`, { raw: true });
        process.stdout.write(`   ${Math.min(i + BATCH, allArticles.length)}/${allArticles.length}\r`);
    }

    if (allArticles.length) {
        const nextAi = await bumpTableAutoIncrement(tgt, 'articles');
        console.log(`   🔢 articles AUTO_INCREMENT → ${nextAi} (new rows omit id; wp_post_id NULL)`);
    }
    console.log(`   ✅ ${allArticles.length} articles`);
}

async function migrateArticleJunctions(src, tgt) {
    console.log('🔗 Migrating article junctions...');
    const articleIdMap = await buildScArticleSurrogateToMsArticleIdMap(src);
    const mapAid = (surrogateId) => articleIdMap[surrogateId] ?? surrogateId;
    const categoryIdMap = await buildScWpPostIdMap(src, 'sc_categories', 'wp_term_id');
    const tagIdMap = await buildScWpPostIdMap(src, 'sc_tags', 'wp_term_id');
    const typeIdMap = await buildScWpPostIdMap(src, 'sc_article_types', 'wp_term_id');
    const courtIdMap = await buildScWpPostIdMap(src, 'sc_courts', 'wp_term_id');
    const mapCat = (id) => categoryIdMap[id] ?? id;
    const mapTag = (id) => tagIdMap[id] ?? id;
    const mapType = (id) => typeIdMap[id] ?? id;
    const mapCourt = (id) => courtIdMap[id] ?? id;

    // Categories
    const cats = await src.query('SELECT * FROM sc_article_categories', { type: QueryTypes.SELECT });
    for (let i = 0; i < cats.length; i += BATCH) {
        const vals = cats.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${mapCat(r.category_id)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_categories (article_id, category_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   categories: ${cats.length}`);

    // Tags
    const tags = await src.query('SELECT * FROM sc_article_tags', { type: QueryTypes.SELECT });
    for (let i = 0; i < tags.length; i += BATCH) {
        const vals = tags.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${mapTag(r.tag_id)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_tags (article_id, tag_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   tags: ${tags.length}`);

    // Types
    const types = await src.query('SELECT * FROM sc_article_types_map', { type: QueryTypes.SELECT });
    for (let i = 0; i < types.length; i += BATCH) {
        const vals = types.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${mapType(r.article_type_id)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_types_map (article_id, article_type_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   types: ${types.length}`);

    // Courts
    const courts = await src.query('SELECT * FROM sc_article_courts', { type: QueryTypes.SELECT });
    for (let i = 0; i < courts.length; i += BATCH) {
        const vals = courts.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${mapCourt(r.court_id)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_courts (article_id, court_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   courts: ${courts.length}`);
    console.log('   ✅ all article junctions');
}

async function migrateComments(src, tgt) {
    console.log('💬 Migrating comments...');
    const rows = await src.query('SELECT * FROM sc_comments ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 comments'); return; }
    const articleIdMap = await buildScArticleSurrogateToMsArticleIdMap(src);
    const userIdMap = await buildScUserIdMap(src);
    const mapAid = (surrogateId) => articleIdMap[surrogateId] ?? surrogateId;
    const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(c => {
            const { id: msId, wpCommentIdSql } = msWpCommentIdExpr(c);
            const userId = mapUid(c.user_id);
            return `(${msId}, ${wpCommentIdSql}, ${mapAid(c.article_id)}, ${userId || 'NULL'}, ${esc(c.author_name)}, ${esc(c.author_email)}, ${esc(c.content, 65535)}, ${c.approved ? 1 : 0}, ${c.parent_id || 'NULL'}, ${escDate(c.created_at)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO comments (id, wp_comment_id, article_id, user_id, author_name, author_email, content, approved, parent_id, created_at) VALUES ${values}`, { raw: true });
    }
    if (rows.length) {
        const nextAi = await bumpTableAutoIncrement(tgt, 'comments');
        console.log(`   🔢 comments AUTO_INCREMENT → ${nextAi}`);
    }
    console.log(`   ✅ ${rows.length} comments`);
}

async function migrateCourses(src, tgt) {
    console.log('🎓 Migrating courses...');

    const rows = await src.query('SELECT * FROM sc_courses ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 courses'); return; }

    const values = rows.map(c => {
        const isPub = c.status === 'publish' ? 1 : 0;
        const courseIncludes = c.course_includes != null && c.course_includes !== '' ? c.course_includes : null;
        const { id: msId, wpRefSql } = msWpEntityIdExpr(c, 'wp_post_id');
        return `(${msId}, ${wpRefSql}, ${esc(c.title)}, ${esc(c.short_title)}, ${esc(c.slug)}, ${esc(c.brief_description)}, ${escUploadContent(c.description, 16000000)}, ${escUploadContent(c.curriculum, 16000000)}, ${esc(c.learn_outcomes)}, ${esc(c.requirements)}, ${esc(c.terms_conditions)}, ${c.price || 0}, ${c.sale_price || 'NULL'}, ${c.enrolled_count || 0}, ${c.ratings || 'NULL'}, ${c.rating_users || 0}, ${escUploadUrl(c.thumbnail_url)}, ${esc(c.youtube_url)}, ${esc(c.language)}, ${esc(c.course_type)}, ${c.taxable ? 1 : 0}, ${esc(c.keywords)}, ${esc(c.meta_title)}, ${esc(c.meta_description)}, ${esc(c.meta_keywords)}, ${esc(c.canonical_url)}, ${esc(c.robots)}, ${esc(c.og_title)}, ${esc(c.og_description)}, ${escUploadUrl(c.og_image_url)}, ${esc(c.faqs, 16000000)}, ${esc(c.feedback, 16000000)}, ${esc(c.includes_info, 16000000)}, ${escUploadContent(courseIncludes, 16000000)}, ${esc(c.certifications)}, ${esc(c.gateway)}, ${isPub}, ${esc(c.status)}, ${escDate(c.start_date)}, ${escDate(c.end_date)}, ${escDate(c.created_at)}, ${escDate(c.updated_at)})`;
    }).join(',');
    await tgt.query(`INSERT INTO courses (id, wp_post_id, title, short_title, slug, brief_description, description, curriculum, learn_outcomes, requirements, terms_conditions, price, sale_price, enrolled_count, ratings, rating_users, thumbnail_url, youtube_url, language, course_type, taxable, keywords, meta_title, meta_description, meta_keywords, canonical_url, robots, og_title, og_description, og_image_url, faqs, feedback, includes_info, course_includes, certifications, gateway, is_published, status, start_date, end_date, created_at, updated_at) VALUES ${values}${COURSE_UPSERT_TAIL}`, { raw: true });
    if (rows.length) {
        const nextAi = await bumpTableAutoIncrement(tgt, 'courses');
        console.log(`   🔢 courses AUTO_INCREMENT → ${nextAi}`);
    }
    console.log(`   ✅ ${rows.length} courses`);
}

/** Migrate batches (course batches). Source: batches or sc_batches if present. Uses upsert to preserve admin-created batches. */
async function migrateBatches(src, tgt) {
    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('batches', 'sc_batches')",
        { type: QueryTypes.SELECT }
    );
    const name = tables.some(t => t.TABLE_NAME === 'sc_batches') ? 'sc_batches' : (tables.some(t => t.TABLE_NAME === 'batches') ? 'batches' : null);
    if (!name) { console.log('   ⏭️  No batches/sc_batches in source; skip (existing batches preserved).'); return; }
    console.log('📦 Migrating batches (upsert — admin-created batches preserved)...');
    const rows = await src.query(`SELECT * FROM \`${name}\` ORDER BY id`, { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 source batches (existing batches preserved)'); return; }
    const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
    const mapCid = (id) => courseIdMap[id] ?? id;
    const courseIds = await tgt.query('SELECT id FROM courses', { type: QueryTypes.SELECT });
    const validIds = new Set((courseIds || []).map(r => r.id));
    const filtered = rows.filter(r => validIds.has(mapCid(r.course_id)));
    for (let i = 0; i < filtered.length; i += BATCH) {
        const chunk = filtered.slice(i, i + BATCH);
        const values = chunk.map(b => `(${b.id}, ${mapCid(b.course_id)}, ${esc(b.name)}, ${escDate(b.start_date)}, ${escDate(b.end_date)}, ${esc(b.meet_link)})`).join(',');
        await tgt.query(`INSERT INTO batches (id, course_id, name, start_date, end_date, meet_link) VALUES ${values} ON DUPLICATE KEY UPDATE course_id=VALUES(course_id), name=VALUES(name), start_date=VALUES(start_date), end_date=VALUES(end_date), meet_link=VALUES(meet_link)`, { raw: true });
    }
    console.log(`   ✅ ${filtered.length} source batches synced (admin-created batches preserved)`);
}

/** Migrate sessions (batch days). Source: sessions or sc_sessions if present. Uses upsert to preserve admin-created sessions. */
async function migrateSessions(src, tgt) {
    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sessions', 'sc_sessions')",
        { type: QueryTypes.SELECT }
    );
    const name = tables.some(t => t.TABLE_NAME === 'sc_sessions') ? 'sc_sessions' : (tables.some(t => t.TABLE_NAME === 'sessions') ? 'sessions' : null);
    if (!name) { console.log('   ⏭️  No sessions/sc_sessions in source; skip (existing sessions preserved).'); return; }
    console.log('📅 Migrating sessions (upsert — admin-created sessions preserved)...');
    const batchIds = await tgt.query('SELECT id FROM batches', { type: QueryTypes.SELECT });
    const validBatchIds = new Set((batchIds || []).map(r => r.id));
    const rows = await src.query(`SELECT * FROM \`${name}\` ORDER BY id`, { type: QueryTypes.SELECT });
    const filtered = rows.filter(r => validBatchIds.has(r.batch_id));
    if (!filtered.length) { console.log('   ✅ 0 source sessions (existing sessions preserved)'); return; }
    for (let i = 0; i < filtered.length; i += BATCH) {
        const chunk = filtered.slice(i, i + BATCH);
        const values = chunk.map(s => `(${s.id}, ${s.batch_id}, ${s.day_number ?? 1}, ${esc(s.title)}, ${escDate(s.scheduled_at)}, ${esc(s.meet_link)})`).join(',');
        await tgt.query(`INSERT INTO sessions (id, batch_id, day_number, title, scheduled_at, meet_link) VALUES ${values} ON DUPLICATE KEY UPDATE batch_id=VALUES(batch_id), day_number=VALUES(day_number), title=VALUES(title), scheduled_at=VALUES(scheduled_at), meet_link=VALUES(meet_link)`, { raw: true });
    }
    console.log(`   ✅ ${filtered.length} source sessions synced (admin-created sessions preserved)`);
}

/** Migrate recordings (per-session recording links). Source: recordings or sc_recordings if present. Uses upsert to preserve admin-created recordings. */
async function migrateRecordings(src, tgt) {
    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('recordings', 'sc_recordings')",
        { type: QueryTypes.SELECT }
    );
    const name = tables.some(t => t.TABLE_NAME === 'sc_recordings') ? 'sc_recordings' : (tables.some(t => t.TABLE_NAME === 'recordings') ? 'recordings' : null);
    if (!name) { console.log('   ⏭️  No recordings/sc_recordings in source; skip (existing recordings preserved).'); return; }
    console.log('🎬 Migrating recordings (upsert — admin-created recordings preserved)...');
    const sessionIds = await tgt.query('SELECT id FROM sessions', { type: QueryTypes.SELECT });
    const validSessionIds = new Set((sessionIds || []).map(r => r.id));
    const rows = await src.query(`SELECT * FROM \`${name}\` ORDER BY id`, { type: QueryTypes.SELECT });
    const filtered = rows.filter(r => validSessionIds.has(r.session_id));
    if (!filtered.length) { console.log('   ✅ 0 source recordings (existing recordings preserved)'); return; }
    for (let i = 0; i < filtered.length; i += BATCH) {
        const chunk = filtered.slice(i, i + BATCH);
        const values = chunk.map(r => `(${r.id}, ${r.session_id}, ${esc(r.url)}, ${esc(r.source)}, ${recordingIsVisibleFlag(r)})`).join(',');
        await tgt.query(`INSERT INTO recordings (id, session_id, url, source, is_visible) VALUES ${values} ON DUPLICATE KEY UPDATE session_id=VALUES(session_id), url=VALUES(url), source=VALUES(source), is_visible=VALUES(is_visible)`, { raw: true });
    }
    console.log(`   ✅ ${filtered.length} source recordings synced (admin-created recordings preserved)`);
}

async function migrateCourseJunctions(src, tgt) {
    console.log('🔗 Migrating course junctions...');
    const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
    const courseCatIdMap = await buildScWpPostIdMap(src, 'sc_course_cats', 'wp_term_id');
    const mapCid = (id) => courseIdMap[id] ?? id;
    const mapCourseCat = (id) => courseCatIdMap[id] ?? id;
    const cats = await src.query('SELECT * FROM sc_course_categories', { type: QueryTypes.SELECT });
    if (cats.length) {
        const vals = cats.map(r => `(${mapCid(r.course_id)}, ${mapCourseCat(r.course_cat_id)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO course_categories (course_id, course_cat_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   course-cats: ${cats.length}`);
    console.log('   ✅ course junctions');
}

/** WP legacy orders used draft/publish as post status; rp_payment_id means captured payment. */
function normalizeMigratedOrderStatus(o) {
    const rpPay = o.rp_payment_id && String(o.rp_payment_id).trim();
    if (rpPay) return 'paid';
    const raw = String(o.status || '').toLowerCase().trim();
    if (raw === 'paid') return 'paid';
    if (raw === 'trash' || raw === 'cancelled' || raw === 'failed') return 'cancelled';
    return 'pending';
}

async function migrateOrders(src, tgt) {
    console.log('🛒 Migrating orders...');
    await tgt.query('DELETE FROM orders', { raw: true });

    const total = await src.query('SELECT COUNT(*) as c FROM sc_orders', { type: QueryTypes.SELECT });
    console.log(`   Source: ${total[0].c} orders`);

    const allOrders = await src.query('SELECT * FROM sc_orders ORDER BY id', { type: QueryTypes.SELECT });
    const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
    const userIdMap = await buildScUserIdMap(src);
    const mapCid = (id) => (id != null && id !== '' ? (courseIdMap[id] ?? id) : null);
    const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);

    for (let i = 0; i < allOrders.length; i += BATCH) {
        const chunk = allOrders.slice(i, i + BATCH);
        const values = chunk.map(o => {
            const { id: msId, wpRefSql } = msWpEntityIdExpr(o, 'wp_post_id');
            const orderId = esc(`ORD_${msId}`);
            const courseId = mapCid(o.course_id);
            const userId = mapUid(o.user_id);
            const type = courseId != null ? 'course' : 'membership';
            const entityId = courseId != null ? esc(String(courseId)) : 'NULL';
            const originalAmount = o.original_amount != null ? o.original_amount : (o.amount || 'NULL');
            const couponCode = o.coupon_code ? esc(o.coupon_code) : 'NULL';
            const couponDiscount = o.coupon_discount != null ? o.coupon_discount : 0;
            const status = normalizeMigratedOrderStatus(o);
            const wpPostStatus = o.wp_post_status ? esc(String(o.wp_post_status).toLowerCase().trim()) : 'NULL';
            return `(${msId}, ${wpRefSql}, ${orderId}, ${userId || 'NULL'}, ${courseId || 'NULL'}, ${esc(type)}, ${entityId}, ${o.amount || 'NULL'}, ${originalAmount}, ${couponCode}, ${couponDiscount}, 'INR', ${esc(o.buyer_name)}, ${esc(o.buyer_email)}, ${esc(o.buyer_mobile)}, ${esc(o.rp_payment_id)}, NULL, ${esc(o.affiliate)}, ${esc(o.certificate_name)}, ${esc(o.certificate_issue_date)}, ${esc(status)}, ${esc(o.gateway)}, ${wpPostStatus}, ${escDate(o.created_at)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO orders (id, wp_post_id, order_id, user_id, course_id, type, entity_id, amount, original_amount, coupon_code, coupon_discount, currency, buyer_name, buyer_email, buyer_mobile, rp_payment_id, razorpay_order_id, affiliate, certificate_name, certificate_issue_date, status, gateway, wp_post_status, created_at) VALUES ${values}`, { raw: true });
        process.stdout.write(`   ${Math.min(i + BATCH, allOrders.length)}/${allOrders.length}\r`);
    }
    if (allOrders.length) {
        const nextAi = await bumpTableAutoIncrement(tgt, 'orders');
        console.log(`   🔢 orders AUTO_INCREMENT → ${nextAi}`);
    }
    console.log(`   ✅ ${allOrders.length} orders`);
}

async function migrateCoupons(src, tgt) {
    console.log('🎫 Migrating coupons...');
    await tgt.query('DELETE FROM coupons', { raw: true });
    const rows = await src.query('SELECT * FROM sc_coupons ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 coupons'); return; }
    const values = rows.map(c => {
        const visibility = esc(c.visibility || 'public');
        const usageLimit = c.usage_limit != null ? c.usage_limit : 'NULL';
        const perUserLimit = c.per_user_limit != null ? c.per_user_limit : 1;
        const { id: msId, wpRefSql } = msWpEntityIdExpr(c, 'wp_post_id');
        return `(${msId}, ${wpRefSql}, ${esc(c.code)}, ${esc(c.description)}, ${esc(c.type)}, ${c.value || 'NULL'}, ${c.min_order || 'NULL'}, ${c.max_discount || 'NULL'}, ${esc(c.discount_on)}, ${escDate(c.start_date)}, ${escDate(c.expire_date)}, ${esc(c.status)}, ${visibility}, ${usageLimit}, ${perUserLimit}, ${escDate(c.created_at)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO coupons (id, wp_post_id, code, description, type, value, min_order, max_discount, discount_on, start_date, expire_date, status, visibility, usage_limit, per_user_limit, created_at) VALUES ${values}`, { raw: true });
    if (rows.length) {
        const nextAi = await bumpTableAutoIncrement(tgt, 'coupons');
        console.log(`   🔢 coupons AUTO_INCREMENT → ${nextAi}`);
    }
    console.log(`   ✅ ${rows.length} coupons`);
}

async function migrateFiles(src, tgt) {
    console.log('📎 Migrating files...');
    try {
        const rows = await src.query('SELECT * FROM sc_files ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM file_categories', { raw: true });
        await tgt.query('DELETE FROM files', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 files'); return; }
        const userIdMap = await buildScUserIdMap(src);
        const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(f => {
                const { id: msId, wpRefSql } = msWpEntityIdExpr(f, 'wp_post_id');
                const authorId = mapUid(f.author_id);
                return `(${msId}, ${wpRefSql}, ${esc(f.title, 65535)}, ${esc(f.slug)}, ${escUploadUrl(f.file_url)}, ${authorId || 'NULL'}, ${f.views || 0}, ${esc(f.status)}, ${esc(f.meta_title)}, ${esc(f.meta_description)}, ${esc(f.meta_keywords)}, ${escDate(f.created_at)})`;
            }).join(',');
            await tgt.query(`INSERT IGNORE INTO files (id, wp_post_id, title, slug, file_url, author_id, views, status, meta_title, meta_description, meta_keywords, created_at) VALUES ${values}`, { raw: true });
        }
        if (rows.length) {
            const nextAi = await bumpTableAutoIncrement(tgt, 'files');
            console.log(`   🔢 files AUTO_INCREMENT → ${nextAi}`);
        }
        console.log(`   ✅ ${rows.length} files`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_files not in source, skip'); return; }
        throw e;
    }
}

async function migrateFileCategories(src, tgt) {
    console.log('🔗 Migrating file_categories...');
    try {
        const fileIdMap = await buildScWpPostIdMap(src, 'sc_files', 'wp_post_id');
        const fileCatIdMap = await buildScWpPostIdMap(src, 'sc_file_cats', 'wp_term_id');
        const mapFid = (id) => fileIdMap[id] ?? id;
        const mapFileCat = (id) => fileCatIdMap[id] ?? id;
        const rows = await src.query('SELECT * FROM sc_file_categories', { type: QueryTypes.SELECT });
        if (!rows.length) { console.log('   ✅ 0 file_categories'); return; }
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(r => `(${mapFid(r.file_id)}, ${mapFileCat(r.file_cat_id)})`).join(',');
            await tgt.query(`INSERT IGNORE INTO file_categories (file_id, file_cat_id) VALUES ${values}`, { raw: true });
        }
        console.log(`   ✅ ${rows.length} file_categories`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_file_categories not in source, skip'); return; }
        throw e;
    }
}

const CMS_PAGE_SLUGS = ['home', 'about', 'contact', 'privacy-policy', 'ethics-policy', 'terms-of-use', 'disclaimer', 'refund-policy'];

async function migratePages(src, tgt) {
    console.log('📄 Migrating pages...');
    try {
        const rows = await src.query('SELECT * FROM sc_pages ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM pages', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 pages'); return; }
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(p => {
                const { id: msId, wpRefSql } = msWpEntityIdExpr(p, 'wp_post_id');
                return `(${msId}, ${wpRefSql}, ${esc(p.title)}, ${esc(p.slug)}, ${escUploadContent(p.content, 16000000)}, ${esc(p.template)}, ${esc(p.meta_title)}, ${esc(p.meta_description)}, ${esc(p.meta_keywords)}, ${esc(p.status)}, ${escDate(p.created_at)}, ${escDate(p.updated_at)})`;
            }).join(',');
            await tgt.query(`INSERT IGNORE INTO pages (id, wp_post_id, title, slug, content, template, meta_title, meta_description, meta_keywords, status, created_at, updated_at) VALUES ${values}`, { raw: true });
        }
        if (rows.length) {
            const nextAi = await bumpTableAutoIncrement(tgt, 'pages');
            console.log(`   🔢 pages AUTO_INCREMENT → ${nextAi}`);
        }
        console.log(`   ✅ ${rows.length} pages`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_pages not in source, skip'); return; }
        throw e;
    }
}

/** Seed cms_pages from WP source only for slugs we manage; never overwrite existing rows (preserve our edits). */
async function seedCmsPagesFromSource(src, tgt) {
    console.log('📄 Seeding cms_pages (only missing slugs)...');
    try {
        const existing = await tgt.query('SELECT slug FROM cms_pages', { type: QueryTypes.SELECT });
        const existingSlugs = new Set((existing || []).map((r) => r.slug));
        const placeholders = CMS_PAGE_SLUGS.map(() => '?').join(',');
        const rows = await src.query(
            `SELECT slug, title, content FROM sc_pages WHERE slug IN (${placeholders})`,
            { replacements: CMS_PAGE_SLUGS, type: QueryTypes.SELECT }
        );
        let inserted = 0;
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        for (const p of rows) {
            if (!p.slug || existingSlugs.has(p.slug)) continue;
            await tgt.query(
                'INSERT INTO cms_pages (slug, title, content, meta, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)',
                { replacements: [p.slug, p.title || p.slug, rewriteStudycafeUploadUrlsInContent(p.content || null), now, now], raw: true }
            );
            existingSlugs.add(p.slug);
            inserted++;
        }
        console.log(`   ✅ cms_pages: ${inserted} seeded (existing rows preserved)`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_pages or cms_pages not present, skip'); return; }
        throw e;
    }
}

/**
 * Ensure the seo_metadata table has the full column set used by the SeoMetadata
 * model (the inline stub is minimal; production was built via Sequelize sync, but
 * we ALTER-in any missing columns to be safe and self-contained).
 */
async function ensureSeoMetadataColumns(tgt) {
    const cols = [
        ['meta_keywords', 'VARCHAR(500) NULL'],
        ['canonical_url', 'VARCHAR(1000) NULL'],
        ['og_title', 'VARCHAR(255) NULL'],
        ['og_description', 'TEXT NULL'],
        ['og_image_url', 'VARCHAR(1000) NULL'],
    ];
    for (const [name, ddl] of cols) {
        const existing = await tgt.query(`SHOW COLUMNS FROM seo_metadata LIKE '${name}'`, { type: QueryTypes.SELECT });
        if (!existing.length) {
            await tgt.query(`ALTER TABLE seo_metadata ADD COLUMN ${name} ${ddl}`, { raw: true });
        }
    }
}

/**
 * Default SEO for top-level public site routes ( /, /about, /courses, ... ).
 * These have no per-entity fallback at runtime, so we seed seo_metadata rows for
 * them. Existing rows (admin-entered) are preserved — we only INSERT missing paths.
 * Page-specific routes draw their title/description from migrated sc_pages SEO,
 * falling back to sensible site defaults.
 */
async function seedSeoMetadata(src, tgt) {
    console.log('🔍 Seeding seo_metadata for site routes (missing paths only)...');
    try {
        await ensureSeoMetadataColumns(tgt);

        const SITE_NAME = 'Studycafe';
        const SITE_DESC = 'One Stop Solution For CA CS CWA Direct Indirect Tax GST Business News';

        // Map of public route path → { name, slug-in-sc_pages (optional) }
        const ROUTES = [
            { path: '/', name: 'Home', pageSlug: 'home', title: `${SITE_NAME} - ${SITE_DESC}`, desc: SITE_DESC },
            { path: '/about', name: 'About', pageSlug: 'about', title: `About Us - ${SITE_NAME}` },
            { path: '/contact', name: 'Contact', pageSlug: 'contact', title: `Contact Us - ${SITE_NAME}` },
            { path: '/courses', name: 'Courses', title: `Online Courses - ${SITE_NAME}`, desc: `Explore CA, CS, CMA and Tax courses on ${SITE_NAME}.` },
            { path: '/blogs', name: 'Blogs', title: `Latest Articles & Updates - ${SITE_NAME}`, desc: SITE_DESC },
            { path: '/downloads', name: 'Downloads', title: `Free Downloads - ${SITE_NAME}`, desc: `Download notifications, circulars and study material from ${SITE_NAME}.` },
            { path: '/plans', name: 'Plans', title: `Membership Plans - ${SITE_NAME}`, desc: `Choose a ${SITE_NAME} membership to unlock premium courses and content.` },
            { path: '/privacy-policy', name: 'Privacy Policy', pageSlug: 'privacy-policy', title: `Privacy Policy - ${SITE_NAME}` },
            { path: '/terms-of-use', name: 'Terms of Use', pageSlug: 'terms-of-use', title: `Terms of Use - ${SITE_NAME}` },
            { path: '/disclaimer', name: 'Disclaimer', pageSlug: 'disclaimer', title: `Disclaimer - ${SITE_NAME}` },
            { path: '/refund-policy', name: 'Refund Policy', pageSlug: 'refund-policy', title: `Refund Policy - ${SITE_NAME}` },
        ];

        // Pull migrated page SEO so route titles/descriptions prefer real content.
        let pageSeoBySlug = {};
        try {
            const pageRows = await src.query(
                'SELECT slug, title, meta_title, meta_description, meta_keywords FROM sc_pages',
                { type: QueryTypes.SELECT }
            );
            pageRows.forEach((p) => { if (p.slug) pageSeoBySlug[p.slug] = p; });
        } catch (_) { /* sc_pages SEO columns may be absent on very old sources */ }

        // Existing seo_metadata paths (normalized, with and without leading slash)
        const existing = await tgt.query('SELECT page_slug FROM seo_metadata', { type: QueryTypes.SELECT });
        const existingPaths = new Set();
        (existing || []).forEach((r) => {
            const s = String(r.page_slug || '').trim();
            if (!s) return;
            existingPaths.add(s);
            existingPaths.add(s.startsWith('/') ? s.slice(1) : `/${s}`);
        });

        let inserted = 0;
        for (const route of ROUTES) {
            if (existingPaths.has(route.path)) continue;
            const pg = route.pageSlug ? pageSeoBySlug[route.pageSlug] : null;
            const metaTitle = (pg && (pg.meta_title || pg.title)) || route.title || `${route.name} - ${SITE_NAME}`;
            const metaDescription = (pg && pg.meta_description) || route.desc || SITE_DESC;
            const metaKeywords = (pg && pg.meta_keywords) || null;
            await tgt.query(
                `INSERT INTO seo_metadata (page_name, page_slug, meta_title, meta_description, meta_keywords, og_title, og_description, robots)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'index, follow')`,
                { replacements: [route.name, route.path, String(metaTitle).slice(0, 255), metaDescription, metaKeywords, String(metaTitle).slice(0, 255), metaDescription], raw: true }
            );
            existingPaths.add(route.path);
            inserted++;
        }
        console.log(`   ✅ seo_metadata: ${inserted} site routes seeded (existing rows preserved)`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  seo_metadata not present, skip'); return; }
        throw e;
    }
}

/** Seed affiliate page ACF data (FAQs, top earners, services) from WP postmeta into cms_pages. */
async function seedAffiliatePage(src, tgt) {
    console.log('📄 Seeding affiliate page ACF data...');
    try {
        const AFFILIATE_POST_ID = 264389;
        const hasPostmeta = await src.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deepak_postmeta'",
            { type: QueryTypes.SELECT }
        );
        if (!hasPostmeta.length) { console.log('   ⏭️  deepak_postmeta not in source, skip'); return; }

        const metaRows = await src.query(
            `SELECT meta_key, meta_value FROM deepak_postmeta WHERE post_id = ? AND meta_key NOT LIKE '\\_%'`,
            { replacements: [AFFILIATE_POST_ID], type: QueryTypes.SELECT }
        );
        if (!metaRows.length) { console.log('   ⏭️  No affiliate page meta found'); return; }

        const meta = {};
        metaRows.forEach(r => { meta[r.meta_key] = r.meta_value; });

        // Parse FAQs
        const faqCount = parseInt(meta.faqs) || 0;
        const faqs = [];
        for (let i = 0; i < faqCount; i++) {
            const q = meta[`faqs_${i}_question`];
            const a = meta[`faqs_${i}_answer`];
            if (q || a) faqs.push({ question: q || '', answer: a || '' });
        }

        // Parse top earners
        const earnerCount = parseInt(meta.top_earners) || 0;
        const topEarners = [];
        for (let i = 0; i < earnerCount; i++) {
            topEarners.push({
                name: meta[`top_earners_${i}_name`] || '',
                designation: meta[`top_earners_${i}_designation`] || '',
                comment: meta[`top_earners_${i}_comment`] || '',
                picture_url: meta[`top_earners_${i}_picture_url`] || '',
            });
        }

        // Parse services
        const serviceCount = parseInt(meta.services) || 0;
        const services = [];
        for (let i = 0; i < serviceCount; i++) {
            services.push({
                name: meta[`services_${i}_name`] || '',
                link: meta[`services_${i}_link`] || '',
            });
        }

        const acfData = JSON.stringify({
            description: meta.description || '',
            second_paragraph: meta['2nd_paragraph'] || '',
            keywords: meta.keywords || '',
            faqs,
            top_earners: topEarners,
            services,
            founders: meta.founders || '',
            top_selling_courses: meta.top_selling_courses || '',
        });

        // Upsert into cms_pages
        const existing = await tgt.query("SELECT id FROM cms_pages WHERE slug = 'affiliate'", { type: QueryTypes.SELECT });
        const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
        if (existing.length > 0) {
            await tgt.query(
                'UPDATE cms_pages SET meta = ?, updated_at = ? WHERE slug = ?',
                { replacements: [acfData, now, 'affiliate'], raw: true }
            );
        } else {
            await tgt.query(
                'INSERT INTO cms_pages (slug, title, content, meta, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)',
                { replacements: ['affiliate', meta.title || 'Studycafe Affiliate Program', acfData, now, now], raw: true }
            );
        }
        console.log(`   ✅ Affiliate page: ${faqs.length} FAQs, ${topEarners.length} earners, ${services.length} services`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  cms_pages not present, skip'); return; }
        throw e;
    }
}

/** Migrate WP 'links' post type (source→target URL pairs) into redirections table. */
async function migrateWpLinks(src, tgt) {
    console.log('🔗 Migrating WP links as redirections...');
    try {
        const hasPostmeta = await src.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deepak_postmeta'",
            { type: QueryTypes.SELECT }
        );
        if (!hasPostmeta.length) { console.log('   ⏭️  deepak_postmeta not in source, skip'); return; }

        const rows = await src.query(
            `SELECT p.ID,
                MAX(CASE WHEN pm.meta_key='source' THEN pm.meta_value END) as source_url,
                MAX(CASE WHEN pm.meta_key='target' THEN pm.meta_value END) as target_url
             FROM deepak_posts p
             JOIN deepak_postmeta pm ON pm.post_id = p.ID AND pm.meta_key IN ('source','target')
             WHERE p.post_type='links' AND p.post_status='publish'
             GROUP BY p.ID`,
            { type: QueryTypes.SELECT }
        );
        if (!rows.length) { console.log('   ✅ 0 WP links'); return; }

        let inserted = 0;
        for (const r of rows) {
            if (!r.source_url || !r.target_url) continue;
            try {
                await tgt.query(
                    `INSERT IGNORE INTO redirections (source_url, target_url, match_type, status) VALUES (?, ?, 'exact', 'enabled')`,
                    { replacements: [r.source_url.substring(0, 500), r.target_url.substring(0, 500)], raw: true }
                );
                inserted++;
            } catch (_) { }
        }
        console.log(`   ✅ ${inserted} WP links migrated as redirections`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  deepak_posts not in source, skip'); return; }
        throw e;
    }
}

async function migrateRedirections(src, tgt) {
    console.log('↪️  Migrating redirections...');
    try {
        const rows = await src.query('SELECT * FROM sc_redirections ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM redirections', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 redirections'); return; }
        const values = rows.map(r => `(${r.id}, ${esc(r.source_url)}, ${esc(r.target_url)}, ${esc(r.match_type)}, ${esc(r.status)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO redirections (id, source_url, target_url, match_type, status) VALUES ${values}`, { raw: true });
        console.log(`   ✅ ${rows.length} redirections`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_redirections not in source, skip'); return; }
        throw e;
    }
}

async function migrateMedia(src, tgt) {
    console.log('🖼️  Migrating WordPress media (sc_media → media)...');
    try {
        await tgt.query('DELETE FROM media', { raw: true });
        let offset = 0;
        let total = 0;
        let skipped = 0;
        while (true) {
            const rows = await src.query('SELECT * FROM sc_media ORDER BY id LIMIT ? OFFSET ?', { replacements: [BATCH, offset], type: QueryTypes.SELECT });
            if (!rows.length) break;
            const valid = rows.filter((m) => m.url && String(m.url).trim());
            skipped += rows.length - valid.length;
            if (valid.length) {
                const values = valid.map(m => {
                    const { id: msId, wpRefSql } = msWpEntityIdExpr(m, 'wp_post_id');
                    return `(${msId}, ${wpRefSql}, ${esc(m.title)}, ${esc(m.title)}, ${escUploadUrl(m.url)}, ${esc(m.mime_type)}, 'library', ${escDate(m.created_at)})`;
                }).join(',');
                await tgt.query(`INSERT IGNORE INTO media (id, wp_post_id, title, label, url, mime_type, category, created_at) VALUES ${values}`, { raw: true });
                total += valid.length;
            }
            offset += BATCH;
            process.stdout.write(`   ${total} media\r`);
        }
        if (total) {
            const nextAi = await bumpTableAutoIncrement(tgt, 'media');
            console.log(`   🔢 media AUTO_INCREMENT → ${nextAi}`);
        }
        const skipNote = skipped ? ` (${skipped} without url skipped)` : '';
        console.log(total ? `   ✅ ${total} media${skipNote}` : `   ✅ 0 media${skipNote}`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_media not in source, skip'); return; }
        throw e;
    }
}

async function migrateForumTopics(src, tgt) {
    console.log('💬 Migrating forum_topics...');
    try {
        const rows = await src.query('SELECT * FROM sc_forum_topics ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM forum_topics', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 forum_topics'); return; }
        const userIdMap = await buildScUserIdMap(src);
        const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(t => {
                const { id: msId, wpRefSql } = msWpEntityIdExpr(t, 'wp_post_id');
                const authorId = mapUid(t.author_id);
                return `(${msId}, ${wpRefSql}, ${esc(t.title, 65535)}, ${esc(t.slug)}, ${escUploadContent(t.content, 16000000)}, ${esc(t.forum_name)}, ${authorId || 'NULL'}, ${esc(t.status)}, ${escDate(t.created_at)})`;
            }).join(',');
            await tgt.query(`INSERT IGNORE INTO forum_topics (id, wp_post_id, title, slug, content, forum_name, author_id, status, created_at) VALUES ${values}`, { raw: true });
        }
        if (rows.length) {
            const nextAi = await bumpTableAutoIncrement(tgt, 'forum_topics');
            console.log(`   🔢 forum_topics AUTO_INCREMENT → ${nextAi}`);
        }
        console.log(`   ✅ ${rows.length} forum_topics`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_forum_topics not in source, skip'); return; }
        throw e;
    }
}

async function migrateEnrollments(src, tgt) {
    console.log('📝 Migrating enrollments...');
    const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
    const orderIdMap = await buildScWpPostIdMap(src, 'sc_orders', 'wp_post_id');
    const userIdMap = await buildScUserIdMap(src);
    const mapCid = (id) => courseIdMap[id] ?? id;
    const mapOid = (id) => (id != null ? (orderIdMap[id] ?? id) : null);
    const mapUid = (id) => userIdMap[id] ?? id;
    const rows = await src.query('SELECT * FROM sc_enrollments ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 enrollments'); return; }
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(e => {
            const courseId = mapCid(e.course_id);
            const orderId = mapOid(e.order_id);
            const userId = mapUid(e.user_id);
            return `(${e.id}, ${userId}, ${courseId}, ${orderId || 'NULL'}, ${escDate(e.enrolled_at)})`;
        }).join(',');
        await tgt.query(`INSERT INTO enrollments (id, user_id, course_id, order_id, enrolled_at) VALUES ${values}
        ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), course_id=VALUES(course_id), order_id=VALUES(order_id), enrolled_at=VALUES(enrolled_at)`, { raw: true });
    }
    console.log(`   ✅ ${rows.length} enrollments`);
}

/**
 * Populate user_courses from enrollments so auth-service has user→course access.
 *
 * Active vs expired mirrors the legacy site, which keys it off the order's WP
 * workflow status: `publish` = active course, `draft` = expired course. We dedupe
 * by (user, course) here (user_courses PK), preferring ACTIVE: if the user has at
 * least one active (publish) order for the course, expires_at stays NULL (lifetime);
 * only when every order for that course is expired (draft) do we set a past
 * expires_at so membership/access checks treat it as expired.
 */
async function migrateUserCourses(src, tgt) {
    console.log('📚 Migrating user_courses (from enrollments)...');
    const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
    const orderIdMap = await buildScWpPostIdMap(src, 'sc_orders', 'wp_post_id');
    const userIdMap = await buildScUserIdMap(src);
    const mapCid = (id) => courseIdMap[id] ?? id;
    const mapOid = (id) => (id != null ? (orderIdMap[id] ?? id) : null);
    const mapUid = (id) => userIdMap[id] ?? id;

    // Join enrollments to their originating order so we know each order's WP status.
    const rows = await src.query(
        `SELECT e.user_id, e.course_id, e.order_id, e.enrolled_at, o.wp_post_status
         FROM sc_enrollments e
         LEFT JOIN sc_orders o ON o.id = e.order_id`,
        { type: QueryTypes.SELECT }
    );
    if (!rows.length) { console.log('   ✅ 0 user_courses'); return; }

    // Collapse to one row per (user, course); prefer the active (publish) order.
    const byKey = new Map();
    for (const e of rows) {
        const userId = mapUid(e.user_id);
        const courseId = mapCid(e.course_id);
        const key = `${userId}-${courseId}`;
        const wpStatus = String(e.wp_post_status || '').toLowerCase().trim();
        const isActive = wpStatus !== 'draft'; // publish/empty/unknown => treat as active
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, { userId, courseId, orderId: e.order_id, isActive });
        } else if (isActive && !existing.isActive) {
            // Upgrade to active and adopt the active order id.
            existing.isActive = true;
            existing.orderId = e.order_id;
        }
    }

    // Expired courses get a fixed past timestamp so the API/access layer flags them.
    const EXPIRED_AT = '2000-01-01 00:00:00';
    const pairs = [...byKey.values()];
    for (let i = 0; i < pairs.length; i += BATCH) {
        const chunk = pairs.slice(i, i + BATCH);
        const values = chunk.map(e => {
            const orderId = mapOid(e.orderId);
            const expiresAt = e.isActive ? 'NULL' : esc(EXPIRED_AT);
            return `(${e.userId}, ${e.courseId}, ${orderId ? esc(String(orderId)) : 'NULL'}, ${expiresAt})`;
        }).join(',');
        await tgt.query(`INSERT INTO user_courses (user_id, course_id, order_id, expires_at) VALUES ${values}
        ON DUPLICATE KEY UPDATE order_id=VALUES(order_id), expires_at=VALUES(expires_at)`, { raw: true });
    }
    const expiredCount = pairs.filter(p => !p.isActive).length;
    console.log(`   ✅ ${pairs.length} user_courses (${expiredCount} expired)`);
}

/** Enroll purchased users into the first batch per course so dashboard videos are accessible. */
/** Correct legacy rows after upsert sync (safe to re-run). */
async function applyPostMigrationDataPatches(tgt) {
    console.log('🔧 Applying post-migration data patches...');
    try {
        const [c1] = await tgt.query(
            `UPDATE courses SET is_published = 1 WHERE status = 'publish' AND is_published = 0`,
            { raw: true }
        );
        const [c2] = await tgt.query(
            `UPDATE recordings SET is_visible = 1 WHERE (source = 'vimeo' OR source IS NULL OR source = '') AND is_visible = 0`,
            { raw: true }
        );
        const [c3] = await tgt.query(
            `UPDATE orders SET status = 'paid'
             WHERE rp_payment_id IS NOT NULL AND TRIM(rp_payment_id) != ''
             AND status NOT IN ('paid', 'refunded', 'refund_initiated')`,
            { raw: true }
        );
        const [c4] = await tgt.query(
            `UPDATE orders o
             INNER JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(o.buyer_email))
             SET o.user_id = u.id
             WHERE o.user_id IS NULL AND o.buyer_email IS NOT NULL AND TRIM(o.buyer_email) != ''`,
            { raw: true }
        );
        const [c5] = await tgt.query(
            `INSERT IGNORE INTO enrollments (user_id, course_id, order_id, enrolled_at)
             SELECT o.user_id, o.course_id, o.id, COALESCE(o.created_at, NOW())
             FROM orders o
             WHERE o.user_id IS NOT NULL AND o.course_id IS NOT NULL AND o.status = 'paid'
             AND NOT EXISTS (
               SELECT 1 FROM enrollments e WHERE e.user_id = o.user_id AND e.course_id = o.course_id
             )`,
            { raw: true }
        );
        const [c6] = await tgt.query(
            `INSERT IGNORE INTO user_courses (user_id, course_id, order_id)
             SELECT o.user_id, o.course_id, o.order_id
             FROM orders o
             WHERE o.user_id IS NOT NULL AND o.course_id IS NOT NULL AND o.status = 'paid'
             AND NOT EXISTS (
               SELECT 1 FROM user_courses uc WHERE uc.user_id = o.user_id AND uc.course_id = o.course_id
             )`,
            { raw: true }
        );
        console.log(`   courses is_published fixed: ${c1?.affectedRows ?? 0}`);
        console.log(`   recordings is_visible fixed: ${c2?.affectedRows ?? 0}`);
        console.log(`   orders marked paid (rp_payment_id): ${c3?.affectedRows ?? 0}`);
        console.log(`   orders user_id linked by email: ${c4?.affectedRows ?? 0}`);
        console.log(`   enrollments backfilled: ${c5?.affectedRows ?? 0}`);
        console.log(`   user_courses backfilled: ${c6?.affectedRows ?? 0}`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) {
            console.log('   ⏭️  Patch skipped (tables not ready)');
            return;
        }
        throw e;
    }
}

async function migrateBatchEnrollments(src, tgt) {
    console.log('📚 Syncing batch_enrollments from enrollments...');
    try {
        const [result] = await tgt.query(
            `INSERT IGNORE INTO batch_enrollments (batch_id, user_id, enrolled_at)
             SELECT fb.min_batch_id, e.user_id, COALESCE(e.enrolled_at, NOW())
             FROM enrollments e
             INNER JOIN (
               SELECT course_id, MIN(id) AS min_batch_id FROM batches GROUP BY course_id
             ) fb ON fb.course_id = e.course_id
             LEFT JOIN batch_enrollments be ON be.batch_id = fb.min_batch_id AND be.user_id = e.user_id
             WHERE be.id IS NULL`,
            { raw: true }
        );
        console.log(`   ✅ ${result?.affectedRows ?? 0} batch enrollments synced`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) {
            console.log('   ⏭️  batch_enrollments/batches not ready, skip');
            return;
        }
        throw e;
    }
}

async function migrateCourseAuthors(src, tgt) {
    console.log('✍️  Migrating course authors...');
    const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
    const userIdMap = await buildScUserIdMap(src);
    const mapCid = (id) => courseIdMap[id] ?? id;
    const mapUid = (id) => userIdMap[id] ?? id;
    const rows = await src.query('SELECT * FROM sc_course_authors ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 course authors'); return; }
    const values = rows.map(a => `(${a.id}, ${mapCid(a.course_id)}, ${mapUid(a.user_id)}, ${a.sort_order || 0})`).join(',');
    await tgt.query(`INSERT IGNORE INTO course_authors (id, course_id, user_id, sort_order) VALUES ${values}`, { raw: true });
    console.log(`   ✅ ${rows.length} course authors`);
}

/**
 * Migrate affiliate data (history, balances, withdrawal_requests) from source.
 * Source tables are optional; migration is skipped gracefully if they don't exist.
 * Also syncs referral_code/referred_by from sc_users if those columns exist.
 */
async function migrateAffiliateData(src, tgt) {
    console.log('💸 Migrating affiliate data...');

    // ── 1) referral_code + referred_by on users (from sc_users if columns exist) ──
    try {
        const cols = await src.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN ('referral_code','referred_by','referred_at')",
            { replacements: [_srcUsersTable], type: QueryTypes.SELECT }
        );
        const hasReferral = cols.some(c => c.COLUMN_NAME === 'referral_code');
        if (hasReferral) {
            const userIdMap = await buildScUserIdMap(src);
            const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);
            const rows = await src.query(
                `SELECT id, referral_code, referred_by, referred_at FROM \`${_srcUsersTable}\` WHERE referral_code IS NOT NULL`,
                { type: QueryTypes.SELECT }
            );
            let updated = 0;
            for (const r of rows) {
                try {
                    await tgt.query(
                        'UPDATE users SET referral_code = ?, referred_by = ?, referred_at = ? WHERE id = ?',
                        { replacements: [r.referral_code, mapUid(r.referred_by), r.referred_at || null, mapUid(r.id)], raw: true }
                    );
                    updated++;
                } catch (_) { }
            }
            if (updated > 0) console.log(`   referral_codes: ${updated} users updated`);
        }
    } catch (_) { }

    // ── 2) affiliate_history ──
    try {
        const tables = await src.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'affiliate_history'",
            { type: QueryTypes.SELECT }
        );
        if (tables.length) {
            const rows = await src.query('SELECT * FROM affiliate_history ORDER BY id', { type: QueryTypes.SELECT });
            if (rows.length) {
                const userIdMap = await buildScUserIdMap(src);
                const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
                const mapUid = (id) => userIdMap[id] ?? id;
                const mapCid = (id) => (id != null && id !== '' ? (courseIdMap[id] ?? id) : null);
                await tgt.query('DELETE FROM affiliate_history', { raw: true });
                for (let i = 0; i < rows.length; i += BATCH) {
                    const chunk = rows.slice(i, i + BATCH);
                    const values = chunk.map(r => {
                        const entityType = esc(r.entity_type || 'course');
                        const courseId = mapCid(r.course_id);
                        const entityId = r.entity_id ? esc(String(mapCid(r.entity_id) ?? r.entity_id)) : 'NULL';
                        return `(${r.id}, ${courseId || 'NULL'}, ${entityType}, ${entityId}, ${mapUid(r.user_id)}, ${mapUid(r.affiliate_id)}, ${esc(r.order_id)}, ${r.order_amount || 'NULL'}, ${r.commission_amount || 0}, ${esc(r.status || 'confirmed')}, ${escDate(r.created_at)})`;
                    }).join(',');
                    await tgt.query(
                        `INSERT IGNORE INTO affiliate_history (id, course_id, entity_type, entity_id, user_id, affiliate_id, order_id, order_amount, commission_amount, status, created_at) VALUES ${values}`,
                        { raw: true }
                    );
                }
                console.log(`   affiliate_history: ${rows.length} rows`);
            } else {
                console.log('   affiliate_history: 0 rows (source empty)');
            }
        } else {
            console.log('   ⏭️  affiliate_history not in source; skip');
        }
    } catch (e) {
        console.warn('   ⚠️  affiliate_history migration failed:', e.message);
    }

    // ── 3) affiliate_balances ──
    try {
        const tables = await src.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'affiliate_balances'",
            { type: QueryTypes.SELECT }
        );
        if (tables.length) {
            const rows = await src.query('SELECT * FROM affiliate_balances ORDER BY id', { type: QueryTypes.SELECT });
            if (rows.length) {
                const userIdMap = await buildScUserIdMap(src);
                const mapUid = (id) => userIdMap[id] ?? id;
                await tgt.query('DELETE FROM affiliate_balances', { raw: true });
                const values = rows.map(r =>
                    `(${r.id}, ${mapUid(r.affiliate_id)}, ${r.total_earned || 0}, ${r.total_withdrawn || 0}, ${r.current_balance || 0}, ${escDate(r.created_at)})`
                ).join(',');
                await tgt.query(
                    `INSERT IGNORE INTO affiliate_balances (id, affiliate_id, total_earned, total_withdrawn, current_balance, created_at) VALUES ${values}`,
                    { raw: true }
                );
                console.log(`   affiliate_balances: ${rows.length} rows`);
            } else {
                console.log('   affiliate_balances: 0 rows');
            }
        } else {
            console.log('   ⏭️  affiliate_balances not in source; skip');
        }
    } catch (e) {
        console.warn('   ⚠️  affiliate_balances migration failed:', e.message);
    }

    // ── 4) withdrawal_requests ──
    try {
        const tables = await src.query(
            "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'withdrawal_requests'",
            { type: QueryTypes.SELECT }
        );
        if (tables.length) {
            const rows = await src.query('SELECT * FROM withdrawal_requests ORDER BY id', { type: QueryTypes.SELECT });
            if (rows.length) {
                const userIdMap = await buildScUserIdMap(src);
                const mapUid = (id) => userIdMap[id] ?? id;
                await tgt.query('DELETE FROM withdrawal_requests', { raw: true });
                const values = rows.map(r =>
                    `(${r.id}, ${mapUid(r.affiliate_id)}, ${r.amount}, ${esc(r.status || 'pending')}, ${r.remarks ? esc(r.remarks) : 'NULL'}, ${escDate(r.created_at)})`
                ).join(',');
                await tgt.query(
                    `INSERT IGNORE INTO withdrawal_requests (id, affiliate_id, amount, status, remarks, created_at) VALUES ${values}`,
                    { raw: true }
                );
                console.log(`   withdrawal_requests: ${rows.length} rows`);
            } else {
                console.log('   withdrawal_requests: 0 rows');
            }
        } else {
            console.log('   ⏭️  withdrawal_requests not in source; skip');
        }
    } catch (e) {
        console.warn('   ⚠️  withdrawal_requests migration failed:', e.message);
    }

    // ── 5) Derive affiliate earnings from orders (WP source of truth) ──
    // WordPress has no affiliate_history/affiliate_balances tables; earnings live on
    // each order (`affiliate` = referrer user id, `affiliate_commission` from `utms`).
    // Build affiliate_history + affiliate_balances from migrated sc_orders so the
    // user's earnings / payment report matches the legacy site.
    await deriveAffiliateEarningsFromOrders(src, tgt);

    console.log('   ✅ Affiliate data migration done');
}

/**
 * Reconstruct affiliate earnings from orders. One affiliate_history row per order
 * that has an affiliate (referrer) and a positive commission; affiliate_balances is
 * the per-affiliate aggregate (total_earned = sum of confirmed commissions).
 * Only paid orders count toward earnings (mirrors the legacy report).
 */
async function deriveAffiliateEarningsFromOrders(src, tgt) {
    try {
        // Skip if affiliate_history already has data (e.g. populated from a real source table).
        const existing = await tgt.query('SELECT COUNT(*) c FROM affiliate_history', { type: QueryTypes.SELECT });
        if (Number(existing[0]?.c) > 0) {
            console.log(`   affiliate earnings: ${existing[0].c} history rows already present; skip derivation`);
            return;
        }

        // Does sc_orders carry the affiliate_commission column (added in stage 1)?
        const cols = await src.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sc_orders' AND COLUMN_NAME IN ('affiliate','affiliate_commission')",
            { type: QueryTypes.SELECT }
        );
        const hasAffiliate = cols.some(c => c.COLUMN_NAME === 'affiliate');
        if (!hasAffiliate) { console.log('   ⏭️  sc_orders has no affiliate column; skip earnings derivation'); return; }
        const hasCommission = cols.some(c => c.COLUMN_NAME === 'affiliate_commission');

        const userIdMap = await buildScUserIdMap(src);
        const courseIdMap = await buildScWpPostIdMap(src, 'sc_courses', 'wp_post_id');
        const mapUid = (id) => (id != null && id !== '' ? (userIdMap[id] ?? id) : null);
        const mapCid = (id) => (id != null && id !== '' ? (courseIdMap[id] ?? id) : null);

        const rows = await src.query(
            `SELECT id, user_id, course_id, amount, affiliate, status, created_at${hasCommission ? ', affiliate_commission' : ''}
             FROM sc_orders
             WHERE affiliate IS NOT NULL AND affiliate <> '' AND affiliate <> '0'`,
            { type: QueryTypes.SELECT }
        );
        if (!rows.length) { console.log('   affiliate earnings: 0 orders with an affiliate'); return; }

        await tgt.query('DELETE FROM affiliate_history', { raw: true });
        const balances = new Map(); // affiliateMsId -> total_earned
        let histId = 0;
        const histValues = [];
        for (const o of rows) {
            const affiliateMsId = mapUid(parseInt(o.affiliate, 10));
            if (!affiliateMsId) continue;
            const buyerMsId = mapUid(o.user_id);
            if (!buyerMsId) continue;
            const isPaid = String(o.status || '').toLowerCase() === 'paid';
            const commission = hasCommission && o.affiliate_commission != null ? Number(o.affiliate_commission) : 0;
            if (!(commission > 0)) continue;
            const courseId = mapCid(o.course_id);
            const orderRef = `ORD_${o.id}`;
            const histStatus = isPaid ? 'confirmed' : 'pending';
            histValues.push(`(${++histId}, ${courseId || 'NULL'}, 'course', ${courseId ? esc(String(courseId)) : 'NULL'}, ${buyerMsId}, ${affiliateMsId}, ${esc(orderRef)}, ${o.amount != null ? o.amount : 'NULL'}, ${commission}, ${esc(histStatus)}, ${escDate(o.created_at)})`);
            if (isPaid) balances.set(affiliateMsId, (balances.get(affiliateMsId) || 0) + commission);
        }

        for (let i = 0; i < histValues.length; i += BATCH) {
            const chunk = histValues.slice(i, i + BATCH).join(',');
            await tgt.query(
                `INSERT IGNORE INTO affiliate_history (id, course_id, entity_type, entity_id, user_id, affiliate_id, order_id, order_amount, commission_amount, status, created_at) VALUES ${chunk}`,
                { raw: true }
            );
        }

        // Aggregate balances. Preserve any existing withdrawals; recompute earned/balance.
        for (const [affId, earned] of balances.entries()) {
            await tgt.query(
                `INSERT INTO affiliate_balances (affiliate_id, total_earned, total_withdrawn, current_balance, created_at)
                 VALUES (?, ?, 0, ?, NOW())
                 ON DUPLICATE KEY UPDATE total_earned = VALUES(total_earned),
                   current_balance = VALUES(total_earned) - total_withdrawn`,
                { replacements: [affId, earned, earned], raw: true }
            );
        }

        console.log(`   ✅ affiliate earnings derived: ${histValues.length} history rows, ${balances.size} affiliate balances`);
    } catch (e) {
        console.warn('   ⚠️  affiliate earnings derivation failed:', e.message);
    }
}

// ──── Run ────
main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
