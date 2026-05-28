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
    await migrateRedirections(src, tgt);
    await migrateWpLinks(src, tgt);
    await migrateMedia(src, tgt);
    await mergeLegacyMediaAssets(tgt);
    await migrateForumTopics(src, tgt);
    await migrateEnrollments(src, tgt);
    await migrateUserCourses(src, tgt);
    await migrateCourseAuthors(src, tgt);
    await migrateAffiliateData(src, tgt);

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
      parent_id BIGINT UNSIGNED
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
      case_name TEXT,
      citation TEXT,
      appeal_number VARCHAR(500),
      judgement_date VARCHAR(100),
      assessment_year VARCHAR(50),
      court_name VARCHAR(300),
      section TEXT,
      noti_no VARCHAR(200),
      noti_date VARCHAR(100),
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
      enrolled_at DATETIME
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
      status ENUM('pending','confirmed') NOT NULL DEFAULT 'confirmed',
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
            const passHash = passwords[u.wp_user_id] || null;
            const email = u.email || `wp_${u.wp_user_id || u.id}@placeholder.studycafe.in`;
            const membership = normalizeMembershipSlug(u.membership);
            return `(${u.id}, ${esc(u.wp_user_id)}, ${esc(email)}, ${esc(passHash)}, ${esc(u.display_name)}, ${esc(u.display_name)}, ${esc(u.login)}, ${esc(u.first_name)}, ${esc(u.last_name)}, ${esc(u.user_nicename)}, ${esc(u.user_url)}, ${esc(u.phone)}, ${esc(u.profession)}, ${esc(u.designation)}, ${esc(u.company)}, ${esc(u.city)}, ${esc(u.state)}, ${esc(u.country)}, ${escUploadUrl(u.profile_pic_url)}, ${esc(membership)}, ${esc(u.plan)}, ${defaultUserRoleId}, 'user', 1, ${esc(u.status)}, ${esc(u.facebook)}, ${esc(u.twitter)}, ${esc(u.linkedin)}, ${esc(u.instagram)}, ${esc(u.youtube)}, ${esc(u.gst)}, ${esc(u.account_status)}, ${esc(u.bio)}, ${escDate(u.created_at)}, ${escDate(u.created_at)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO users (id, wp_user_id, email, password_hash, name, display_name, login, first_name, last_name, user_nicename, user_url, phone, profession, designation, company, city, state, country, profile_pic_url, membership, plan, role_id, role, is_active, status, facebook, twitter, linkedin, instagram, youtube, gst, account_status, bio, created_at, updated_at) VALUES ${values}`, { raw: true });
        process.stdout.write(`   ${Math.min(i + BATCH, allUsers.length)}/${allUsers.length}\r`);
    }
    console.log(`   ✅ ${allUsers.length} users migrated (default role: user)`);
}

/**
 * Populate user_memberships from sc_users.membership + sc_users.plan (JSON).
 * WP stored plan as usermeta 'plan' with plan_purchased, plan_expiry, payment_id;
 * the data-migration project copies that into sc_users.plan (TEXT).
 * Legacy WP membership slugs are normalized: advanced→premium, premium→ultimate.
 */
async function migrateUserMemberships(src, tgt) {
    console.log('🎫 Migrating user memberships...');
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
                { replacements: [u.id, membershipType, orderId, start, end], raw: true }
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
 * Migrate plan_courses: which courses are included in each membership plan.
 * Source: deepak_postmeta rel_course on membership course posts (Ultimate/Premium/Basic from sc_courses).
 */
async function migratePlanCourses(src, tgt) {
    console.log('🔗 Migrating plan–course relations...');
    const tables = await src.query(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('sc_courses', 'deepak_postmeta')",
        { type: QueryTypes.SELECT }
    );
    if (!tables.some(t => t.TABLE_NAME === 'sc_courses') || !tables.some(t => t.TABLE_NAME === 'deepak_postmeta')) {
        console.log('   ⏭️ No sc_courses or deepak_postmeta; skip.');
        return;
    }
    const planRows = await tgt.query('SELECT id, slug FROM premium_plans', { type: QueryTypes.SELECT });
    const slugToPlanId = {};
    (planRows || []).forEach((p) => { slugToPlanId[String(p.slug || '').toLowerCase()] = p.id; });
    const courseRows = await tgt.query('SELECT id, wp_post_id FROM courses', { type: QueryTypes.SELECT });
    const wpPostIdToCourseId = {};
    (courseRows || []).forEach((c) => { if (c.wp_post_id != null) wpPostIdToCourseId[Number(c.wp_post_id)] = c.id; });
    const membershipCourses = await src.query(
        `SELECT id, wp_post_id, title, slug FROM sc_courses
         WHERE (title LIKE '%Lifetime Ultimate%' OR title LIKE '%Lifetime Premium%' OR (title LIKE '%Ultimate%' AND title LIKE '%Membership%') OR (title LIKE '%Premium%' AND title LIKE '%Membership%'))
           AND title NOT LIKE 'DUP %'`,
        { type: QueryTypes.SELECT }
    );
    if (!membershipCourses || membershipCourses.length === 0) {
        console.log('   ✅ 0 plan–course links (no membership courses in source)');
        return;
    }
    const wpPostIds = membershipCourses.map((c) => c.wp_post_id).filter(Boolean);
    if (wpPostIds.length === 0) {
        console.log('   ✅ 0 plan–course links');
        return;
    }
    const relRows = await src.query(
        `SELECT post_id, meta_value FROM deepak_postmeta WHERE meta_key = 'rel_course' AND post_id IN (${wpPostIds.join(',')})`,
        { type: QueryTypes.SELECT }
    );
    const relByPostId = {};
    (relRows || []).forEach((r) => { relByPostId[r.post_id] = r.meta_value; });
    await tgt.query('DELETE FROM plan_courses', { raw: true });
    let inserted = 0;
    for (const mc of membershipCourses) {
        const lowerTitle = (mc.title && String(mc.title).toLowerCase()) || '';
        const planSlug = lowerTitle.includes('ultimate') ? 'ultimate' : (lowerTitle.includes('premium') ? 'premium' : null);
        if (!planSlug) continue;
        const planId = slugToPlanId[planSlug];
        if (!planId) continue;
        const raw = relByPostId[mc.wp_post_id];
        const coursePostIds = parsePhpIntArray(raw || '');
        for (const postId of coursePostIds) {
            const courseId = wpPostIdToCourseId[postId];
            if (!courseId) continue;
            try {
                await tgt.query(
                    'INSERT IGNORE INTO plan_courses (plan_id, course_id) VALUES (?, ?)',
                    { replacements: [planId, courseId], raw: true }
                );
                inserted++;
            } catch (_) { }
        }
    }
    console.log(`   ✅ ${inserted} plan–course links`);
}

async function migrateCategories(src, tgt) {
    console.log('📁 Migrating categories...');
    const rows = await src.query('SELECT * FROM sc_categories ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_categories', { raw: true });
    await tgt.query('DELETE FROM categories', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => `(${r.id}, ${esc(r.wp_term_id)}, ${esc(r.name)}, ${esc(r.slug)}, ${r.parent_id || 'NULL'})`).join(',');
    await tgt.query(`INSERT IGNORE INTO categories (id, wp_term_id, name, slug, parent_id) VALUES ${values}`, { raw: true });
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
        const values = chunk.map(r => `(${r.id}, ${esc(r.wp_term_id)}, ${esc(r.name)}, ${esc(r.slug)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO tags (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    }
    console.log(`   ✅ ${rows.length} tags`);
}

async function migrateArticleTypes(src, tgt) {
    console.log('📋 Migrating article types...');
    const rows = await src.query('SELECT * FROM sc_article_types ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_types_map', { raw: true });
    await tgt.query('DELETE FROM article_types', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => `(${r.id}, ${esc(r.wp_term_id)}, ${esc(r.name)}, ${esc(r.slug)})`).join(',');
    await tgt.query(`INSERT IGNORE INTO article_types (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    console.log(`   ✅ ${rows.length} article types`);
}

async function migrateCourts(src, tgt) {
    console.log('⚖️  Migrating courts...');
    const rows = await src.query('SELECT * FROM sc_courts ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM article_courts', { raw: true });
    await tgt.query('DELETE FROM courts', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => `(${r.id}, ${esc(r.wp_term_id)}, ${esc(r.name)}, ${esc(r.slug)})`).join(',');
    await tgt.query(`INSERT IGNORE INTO courts (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    console.log(`   ✅ ${rows.length} courts`);
}

async function migrateCourseCats(src, tgt) {
    console.log('📚 Migrating course cats...');
    const rows = await src.query('SELECT * FROM sc_course_cats ORDER BY id', { type: QueryTypes.SELECT });
    await tgt.query('DELETE FROM course_categories', { raw: true });
    await tgt.query('DELETE FROM course_cats', { raw: true });
    if (!rows.length) return;
    const values = rows.map(r => `(${r.id}, ${esc(r.wp_term_id)}, ${esc(r.name)}, ${esc(r.slug)})`).join(',');
    await tgt.query(`INSERT IGNORE INTO course_cats (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
    console.log(`   ✅ ${rows.length} course cats`);
}

async function migrateFileCats(src, tgt) {
    console.log('📂 Migrating file cats...');
    try {
        const rows = await src.query('SELECT * FROM sc_file_cats ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM file_categories', { raw: true });
        await tgt.query('DELETE FROM file_cats', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 file cats'); return; }
        const values = rows.map(r => `(${r.id}, ${esc(r.wp_term_id)}, ${esc(r.name)}, ${esc(r.slug)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO file_cats (id, wp_term_id, name, slug) VALUES ${values}`, { raw: true });
        console.log(`   ✅ ${rows.length} file cats`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_file_cats not in source, skip'); return; }
        throw e;
    }
}

/**
 * Migrated WP articles use articles.id = wp_post_id (WordPress post ID). Snapshot rows without
 * wp_post_id keep sc_articles surrogate id and wp_post_id NULL.
 */
function msArticleIdAndWpPostExprFromScRow(a) {
    const wpRaw = a.wp_post_id;
    const wp = wpRaw != null && wpRaw !== '' ? Number(wpRaw) : null;
    if (wp != null && Number.isFinite(wp) && wp > 0) {
        return { id: wp, wpPostIdSql: String(wp) };
    }
    return { id: Number(a.id), wpPostIdSql: 'NULL' };
}

/** sc_articles.id (snapshot PK) → articles.id in target (WP post id when present). */
async function buildScArticleSurrogateToMsArticleIdMap(src) {
    const rows = await src.query('SELECT id, wp_post_id FROM sc_articles', { type: QueryTypes.SELECT });
    const map = Object.create(null);
    for (const row of rows || []) {
        const wp = row.wp_post_id != null && row.wp_post_id !== '' ? Number(row.wp_post_id) : null;
        map[row.id] = wp != null && Number.isFinite(wp) && wp > 0 ? wp : Number(row.id);
    }
    return map;
}

async function migrateArticles(src, tgt) {
    console.log('📰 Migrating articles...');
    const total = await src.query('SELECT COUNT(*) as c FROM sc_articles', { type: QueryTypes.SELECT });
    console.log(`   Source: ${total[0].c} articles`);

    await tgt.query('DELETE FROM comments', { raw: true });
    await tgt.query('DELETE FROM article_categories', { raw: true });
    await tgt.query('DELETE FROM article_tags', { raw: true });
    await tgt.query('DELETE FROM article_types_map', { raw: true });
    await tgt.query('DELETE FROM article_courts', { raw: true });
    await tgt.query('DELETE FROM articles', { raw: true });

    const allArticles = await src.query('SELECT * FROM sc_articles ORDER BY id', { type: QueryTypes.SELECT });

    for (let i = 0; i < allArticles.length; i += BATCH) {
        const chunk = allArticles.slice(i, i + BATCH);
        const values = chunk.map(a => {
            const accessTier = esc(a.blog_access_tier || 'free');
            const { id: msId, wpPostIdSql } = msArticleIdAndWpPostExprFromScRow(a);
            return `(${msId}, ${wpPostIdSql}, ${esc(a.title, 65535)}, ${esc(a.slug)}, ${escUploadContent(a.content, 16000000)}, ${esc(a.excerpt, 65535)}, ${esc(a.sub_heading)}, ${a.author_id || 'NULL'}, ${escUploadUrl(a.thumbnail_url)}, ${a.views || 0}, ${esc(a.meta_title)}, ${esc(a.meta_description)}, ${esc(a.meta_keywords)}, ${esc(a.case_name)}, ${esc(a.citation)}, ${esc(a.appeal_number)}, ${esc(a.judgement_date)}, ${esc(a.assessment_year)}, ${esc(a.court_name)}, ${esc(a.section)}, ${esc(a.noti_no)}, ${esc(a.noti_date)}, ${esc(a.ext_link)}, ${escUploadUrl(a.upload_url)}, ${escUploadUrl(a.rel_download_url)}, ${esc(a.external_links)}, ${esc(a.status)}, ${accessTier}, ${escDate(a.published_at)}, ${escDate(a.created_at)}, ${escDate(a.updated_at)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO articles (id, wp_post_id, title, slug, content, excerpt, sub_heading, author_id, thumbnail_url, views, meta_title, meta_description, meta_keywords, case_name, citation, appeal_number, judgement_date, assessment_year, court_name, section, noti_no, noti_date, ext_link, upload_url, rel_download_url, external_links, status, blog_access_tier, published_at, created_at, updated_at) VALUES ${values}`, { raw: true });
        process.stdout.write(`   ${Math.min(i + BATCH, allArticles.length)}/${allArticles.length}\r`);
    }

    if (allArticles.length) {
        const [mx] = await tgt.query('SELECT IFNULL(MAX(id), 0) AS m FROM articles', { type: QueryTypes.SELECT });
        const nextAi = Number(mx.m) + 1;
        await tgt.query(`ALTER TABLE articles AUTO_INCREMENT = ${nextAi}`, { raw: true });
        console.log(`   🔢 articles AUTO_INCREMENT → ${nextAi} (new rows omit id; wp_post_id NULL)`);
    }
    console.log(`   ✅ ${allArticles.length} articles`);
}

async function migrateArticleJunctions(src, tgt) {
    console.log('🔗 Migrating article junctions...');
    const articleIdMap = await buildScArticleSurrogateToMsArticleIdMap(src);
    const mapAid = (surrogateId) => articleIdMap[surrogateId] ?? surrogateId;

    // Categories
    const cats = await src.query('SELECT * FROM sc_article_categories', { type: QueryTypes.SELECT });
    for (let i = 0; i < cats.length; i += BATCH) {
        const vals = cats.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${r.category_id})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_categories (article_id, category_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   categories: ${cats.length}`);

    // Tags
    const tags = await src.query('SELECT * FROM sc_article_tags', { type: QueryTypes.SELECT });
    for (let i = 0; i < tags.length; i += BATCH) {
        const vals = tags.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${r.tag_id})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_tags (article_id, tag_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   tags: ${tags.length}`);

    // Types
    const types = await src.query('SELECT * FROM sc_article_types_map', { type: QueryTypes.SELECT });
    for (let i = 0; i < types.length; i += BATCH) {
        const vals = types.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${r.article_type_id})`).join(',');
        await tgt.query(`INSERT IGNORE INTO article_types_map (article_id, article_type_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   types: ${types.length}`);

    // Courts
    const courts = await src.query('SELECT * FROM sc_article_courts', { type: QueryTypes.SELECT });
    for (let i = 0; i < courts.length; i += BATCH) {
        const vals = courts.slice(i, i + BATCH).map(r => `(${mapAid(r.article_id)}, ${r.court_id})`).join(',');
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
    const mapAid = (surrogateId) => articleIdMap[surrogateId] ?? surrogateId;
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(c => {
            return `(${c.id}, ${esc(c.wp_comment_id)}, ${mapAid(c.article_id)}, ${c.user_id || 'NULL'}, ${esc(c.author_name)}, ${esc(c.author_email)}, ${esc(c.content, 65535)}, ${c.approved ? 1 : 0}, ${c.parent_id || 'NULL'}, ${escDate(c.created_at)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO comments (id, wp_comment_id, article_id, user_id, author_name, author_email, content, approved, parent_id, created_at) VALUES ${values}`, { raw: true });
    }
    console.log(`   ✅ ${rows.length} comments`);
}

async function migrateCourses(src, tgt) {
    console.log('🎓 Migrating courses...');
    await tgt.query('DELETE FROM course_categories', { raw: true });
    await tgt.query('DELETE FROM course_authors', { raw: true });
    await tgt.query('DELETE FROM enrollments', { raw: true });
    await tgt.query('DELETE FROM courses', { raw: true });

    const rows = await src.query('SELECT * FROM sc_courses ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 courses'); return; }

    const values = rows.map(c => {
        const isPub = c.status === 'publish' ? 1 : 0;
        const courseIncludes = c.course_includes != null && c.course_includes !== '' ? c.course_includes : null;
        return `(${c.id}, ${esc(c.wp_post_id)}, ${esc(c.title)}, ${esc(c.short_title)}, ${esc(c.slug)}, ${esc(c.brief_description)}, ${escUploadContent(c.description, 16000000)}, ${escUploadContent(c.curriculum, 16000000)}, ${esc(c.learn_outcomes)}, ${esc(c.requirements)}, ${esc(c.terms_conditions)}, ${c.price || 0}, ${c.sale_price || 'NULL'}, ${c.enrolled_count || 0}, ${c.ratings || 'NULL'}, ${c.rating_users || 0}, ${escUploadUrl(c.thumbnail_url)}, ${esc(c.youtube_url)}, ${esc(c.language)}, ${esc(c.course_type)}, ${c.taxable ? 1 : 0}, ${esc(c.keywords)}, ${esc(c.faqs, 16000000)}, ${esc(c.feedback, 16000000)}, ${esc(c.includes_info, 16000000)}, ${escUploadContent(courseIncludes, 16000000)}, ${esc(c.certifications)}, ${esc(c.gateway)}, ${isPub}, ${esc(c.status)}, ${escDate(c.start_date)}, ${escDate(c.end_date)}, ${escDate(c.created_at)}, ${escDate(c.updated_at)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO courses (id, wp_post_id, title, short_title, slug, brief_description, description, curriculum, learn_outcomes, requirements, terms_conditions, price, sale_price, enrolled_count, ratings, rating_users, thumbnail_url, youtube_url, language, course_type, taxable, keywords, faqs, feedback, includes_info, course_includes, certifications, gateway, is_published, status, start_date, end_date, created_at, updated_at) VALUES ${values}`, { raw: true });
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
    const courseIds = await tgt.query('SELECT id FROM courses', { type: QueryTypes.SELECT });
    const validIds = new Set((courseIds || []).map(r => r.id));
    const filtered = rows.filter(r => validIds.has(r.course_id));
    for (let i = 0; i < filtered.length; i += BATCH) {
        const chunk = filtered.slice(i, i + BATCH);
        const values = chunk.map(b => `(${b.id}, ${b.course_id}, ${esc(b.name)}, ${escDate(b.start_date)}, ${escDate(b.end_date)}, ${esc(b.meet_link)})`).join(',');
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
        const values = chunk.map(r => `(${r.id}, ${r.session_id}, ${esc(r.url)}, ${esc(r.source)}, ${r.is_visible ? 1 : 0})`).join(',');
        await tgt.query(`INSERT INTO recordings (id, session_id, url, source, is_visible) VALUES ${values} ON DUPLICATE KEY UPDATE session_id=VALUES(session_id), url=VALUES(url), source=VALUES(source), is_visible=VALUES(is_visible)`, { raw: true });
    }
    console.log(`   ✅ ${filtered.length} source recordings synced (admin-created recordings preserved)`);
}

async function migrateCourseJunctions(src, tgt) {
    console.log('🔗 Migrating course junctions...');
    const cats = await src.query('SELECT * FROM sc_course_categories', { type: QueryTypes.SELECT });
    if (cats.length) {
        const vals = cats.map(r => `(${r.course_id}, ${r.course_cat_id})`).join(',');
        await tgt.query(`INSERT IGNORE INTO course_categories (course_id, course_cat_id) VALUES ${vals}`, { raw: true });
    }
    console.log(`   course-cats: ${cats.length}`);
    console.log('   ✅ course junctions');
}

async function migrateOrders(src, tgt) {
    console.log('🛒 Migrating orders...');
    await tgt.query('DELETE FROM orders', { raw: true });

    const total = await src.query('SELECT COUNT(*) as c FROM sc_orders', { type: QueryTypes.SELECT });
    console.log(`   Source: ${total[0].c} orders`);

    const allOrders = await src.query('SELECT * FROM sc_orders ORDER BY id', { type: QueryTypes.SELECT });

    for (let i = 0; i < allOrders.length; i += BATCH) {
        const chunk = allOrders.slice(i, i + BATCH);
        const values = chunk.map(o => {
            const orderId = esc(`ORD_${o.id}`);
            const type = (o.course_id != null && o.course_id !== '') ? 'course' : 'membership';
            const entityId = o.course_id != null && o.course_id !== '' ? esc(String(o.course_id)) : 'NULL';
            const originalAmount = o.original_amount != null ? o.original_amount : (o.amount || 'NULL');
            const couponCode = o.coupon_code ? esc(o.coupon_code) : 'NULL';
            const couponDiscount = o.coupon_discount != null ? o.coupon_discount : 0;
            return `(${o.id}, ${esc(o.wp_post_id)}, ${orderId}, ${o.user_id || 'NULL'}, ${o.course_id || 'NULL'}, ${esc(type)}, ${entityId}, ${o.amount || 'NULL'}, ${originalAmount}, ${couponCode}, ${couponDiscount}, 'INR', ${esc(o.buyer_name)}, ${esc(o.buyer_email)}, ${esc(o.buyer_mobile)}, ${esc(o.rp_payment_id)}, NULL, ${esc(o.affiliate)}, ${esc(o.certificate_name)}, ${esc(o.certificate_issue_date)}, ${esc(o.status)}, ${esc(o.gateway)}, ${escDate(o.created_at)})`;
        }).join(',');
        await tgt.query(`INSERT IGNORE INTO orders (id, wp_post_id, order_id, user_id, course_id, type, entity_id, amount, original_amount, coupon_code, coupon_discount, currency, buyer_name, buyer_email, buyer_mobile, rp_payment_id, razorpay_order_id, affiliate, certificate_name, certificate_issue_date, status, gateway, created_at) VALUES ${values}`, { raw: true });
        process.stdout.write(`   ${Math.min(i + BATCH, allOrders.length)}/${allOrders.length}\r`);
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
        return `(${c.id}, ${esc(c.wp_post_id)}, ${esc(c.code)}, ${esc(c.description)}, ${esc(c.type)}, ${c.value || 'NULL'}, ${c.min_order || 'NULL'}, ${c.max_discount || 'NULL'}, ${esc(c.discount_on)}, ${escDate(c.start_date)}, ${escDate(c.expire_date)}, ${esc(c.status)}, ${visibility}, ${usageLimit}, ${perUserLimit}, ${escDate(c.created_at)})`;
    }).join(',');
    await tgt.query(`INSERT IGNORE INTO coupons (id, wp_post_id, code, description, type, value, min_order, max_discount, discount_on, start_date, expire_date, status, visibility, usage_limit, per_user_limit, created_at) VALUES ${values}`, { raw: true });
    console.log(`   ✅ ${rows.length} coupons`);
}

async function migrateFiles(src, tgt) {
    console.log('📎 Migrating files...');
    try {
        const rows = await src.query('SELECT * FROM sc_files ORDER BY id', { type: QueryTypes.SELECT });
        await tgt.query('DELETE FROM file_categories', { raw: true });
        await tgt.query('DELETE FROM files', { raw: true });
        if (!rows.length) { console.log('   ✅ 0 files'); return; }
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(f => `(${f.id}, ${esc(f.wp_post_id)}, ${esc(f.title, 65535)}, ${esc(f.slug)}, ${escUploadUrl(f.file_url)}, ${f.author_id || 'NULL'}, ${f.views || 0}, ${esc(f.status)}, ${esc(f.meta_title)}, ${esc(f.meta_description)}, ${esc(f.meta_keywords)}, ${escDate(f.created_at)})`).join(',');
            await tgt.query(`INSERT IGNORE INTO files (id, wp_post_id, title, slug, file_url, author_id, views, status, meta_title, meta_description, meta_keywords, created_at) VALUES ${values}`, { raw: true });
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
        const rows = await src.query('SELECT * FROM sc_file_categories', { type: QueryTypes.SELECT });
        if (!rows.length) { console.log('   ✅ 0 file_categories'); return; }
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(r => `(${r.file_id}, ${r.file_cat_id})`).join(',');
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
            const values = chunk.map(p => `(${p.id}, ${esc(p.wp_post_id)}, ${esc(p.title)}, ${esc(p.slug)}, ${escUploadContent(p.content, 16000000)}, ${esc(p.template)}, ${esc(p.status)}, ${escDate(p.created_at)}, ${escDate(p.updated_at)})`).join(',');
            await tgt.query(`INSERT IGNORE INTO pages (id, wp_post_id, title, slug, content, template, status, created_at, updated_at) VALUES ${values}`, { raw: true });
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
                const values = valid.map(m => `(${m.id}, ${esc(m.wp_post_id)}, ${esc(m.title)}, ${esc(m.title)}, ${escUploadUrl(m.url)}, ${esc(m.mime_type)}, 'library', ${escDate(m.created_at)})`).join(',');
                await tgt.query(`INSERT IGNORE INTO media (id, wp_post_id, title, label, url, mime_type, category, created_at) VALUES ${values}`, { raw: true });
                total += valid.length;
            }
            offset += BATCH;
            process.stdout.write(`   ${total} media\r`);
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
        for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const values = chunk.map(t => `(${t.id}, ${esc(t.wp_post_id)}, ${esc(t.title, 65535)}, ${esc(t.slug)}, ${escUploadContent(t.content, 16000000)}, ${esc(t.forum_name)}, ${t.author_id || 'NULL'}, ${esc(t.status)}, ${escDate(t.created_at)})`).join(',');
            await tgt.query(`INSERT IGNORE INTO forum_topics (id, wp_post_id, title, slug, content, forum_name, author_id, status, created_at) VALUES ${values}`, { raw: true });
        }
        console.log(`   ✅ ${rows.length} forum_topics`);
    } catch (e) {
        if (e.message && e.message.includes("doesn't exist")) { console.log('   ⏭️  sc_forum_topics not in source, skip'); return; }
        throw e;
    }
}

async function migrateEnrollments(src, tgt) {
    console.log('📝 Migrating enrollments...');
    const rows = await src.query('SELECT * FROM sc_enrollments ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 enrollments'); return; }
    for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = chunk.map(e => `(${e.id}, ${e.user_id}, ${e.course_id}, ${e.order_id || 'NULL'}, ${escDate(e.enrolled_at)})`).join(',');
        await tgt.query(`INSERT IGNORE INTO enrollments (id, user_id, course_id, order_id, enrolled_at) VALUES ${values}`, { raw: true });
    }
    console.log(`   ✅ ${rows.length} enrollments`);
}

/** Populate user_courses from enrollments so auth-service has user→course access. */
async function migrateUserCourses(src, tgt) {
    console.log('📚 Migrating user_courses (from enrollments)...');
    const rows = await src.query('SELECT user_id, course_id, order_id FROM sc_enrollments', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 user_courses'); return; }
    const seen = new Set();
    const pairs = rows.filter(e => {
        const key = `${e.user_id}-${e.course_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    for (let i = 0; i < pairs.length; i += BATCH) {
        const chunk = pairs.slice(i, i + BATCH);
        const values = chunk.map(e => `(${e.user_id}, ${e.course_id}, ${e.order_id ? esc(String(e.order_id)) : 'NULL'})`).join(',');
        await tgt.query(`INSERT IGNORE INTO user_courses (user_id, course_id, order_id) VALUES ${values}`, { raw: true });
    }
    console.log(`   ✅ ${pairs.length} user_courses`);
}

async function migrateCourseAuthors(src, tgt) {
    console.log('✍️  Migrating course authors...');
    const rows = await src.query('SELECT * FROM sc_course_authors ORDER BY id', { type: QueryTypes.SELECT });
    if (!rows.length) { console.log('   ✅ 0 course authors'); return; }
    const values = rows.map(a => `(${a.id}, ${a.course_id}, ${a.user_id}, ${a.sort_order || 0})`).join(',');
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
            const rows = await src.query(
                `SELECT id, referral_code, referred_by, referred_at FROM \`${_srcUsersTable}\` WHERE referral_code IS NOT NULL`,
                { type: QueryTypes.SELECT }
            );
            let updated = 0;
            for (const r of rows) {
                try {
                    await tgt.query(
                        'UPDATE users SET referral_code = ?, referred_by = ?, referred_at = ? WHERE id = ?',
                        { replacements: [r.referral_code, r.referred_by || null, r.referred_at || null, r.id], raw: true }
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
                await tgt.query('DELETE FROM affiliate_history', { raw: true });
                for (let i = 0; i < rows.length; i += BATCH) {
                    const chunk = rows.slice(i, i + BATCH);
                    const values = chunk.map(r => {
                        const entityType = esc(r.entity_type || 'course');
                        const entityId = r.entity_id ? esc(String(r.entity_id)) : 'NULL';
                        return `(${r.id}, ${r.course_id || 'NULL'}, ${entityType}, ${entityId}, ${r.user_id}, ${r.affiliate_id}, ${esc(r.order_id)}, ${r.order_amount || 'NULL'}, ${r.commission_amount || 0}, ${esc(r.status || 'confirmed')}, ${escDate(r.created_at)})`;
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
                await tgt.query('DELETE FROM affiliate_balances', { raw: true });
                const values = rows.map(r =>
                    `(${r.id}, ${r.affiliate_id}, ${r.total_earned || 0}, ${r.total_withdrawn || 0}, ${r.current_balance || 0}, ${escDate(r.created_at)})`
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
                await tgt.query('DELETE FROM withdrawal_requests', { raw: true });
                const values = rows.map(r =>
                    `(${r.id}, ${r.affiliate_id}, ${r.amount}, ${esc(r.status || 'pending')}, ${r.remarks ? esc(r.remarks) : 'NULL'}, ${escDate(r.created_at)})`
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

    console.log('   ✅ Affiliate data migration done');
}

// ──── Run ────
main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
