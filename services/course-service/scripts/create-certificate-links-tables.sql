-- Public certificate download links.
--
-- An admin picks a course, sets an expiry and gets a shareable token URL. Anyone opening it enters
-- name / phone / email and downloads the certificate. Three tables, and the split is load-bearing:
--
--   certificate_links        the admin-created link
--   public_certificates      identity -> serial ledger, unique on (course_id, email_norm) so one
--                            person claiming through two links for the same course gets ONE serial
--   certificate_link_claims  per-link lead record, unique on (link_id, email_norm) so every link's
--                            admin sees their own lead row
--
-- Those two unique keys cannot live on one table: the second would reject a claim that must be
-- recorded. Serials are drawn from the SAME certificate_counter as learner certificates
-- (create-course-certificates-table.sql) so the SC- series never collides across the two ledgers.
-- Do NOT re-seed certificate_counter here; it already exists.
--
-- NOTE for the bootstrap splitter (db/ensureCertificateLinksTables.js): it strips only lines whose
-- trimmed start is `--`, then splits on `;`. Full-line comments only, and never a `;` in a comment.

CREATE TABLE IF NOT EXISTS certificate_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token VARCHAR(64) NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('draft', 'active', 'disabled') NOT NULL DEFAULT 'draft',
  expires_at DATETIME NOT NULL,
  certificate_date DATE NULL,
  max_claims INT UNSIGNED NULL,
  claims_count INT UNSIGNED NOT NULL DEFAULT 0,
  send_email TINYINT(1) NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NULL,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_certlink_token (token),
  KEY idx_certlink_course (course_id),
  KEY idx_certlink_status_expires (status, expires_at),
  KEY idx_certlink_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS public_certificates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  email_norm VARCHAR(190) NOT NULL,
  name VARCHAR(190) NOT NULL,
  phone_norm VARCHAR(32) NULL,
  serial INT UNSIGNED NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pubcert_course_email (course_id, email_norm),
  UNIQUE KEY uq_pubcert_serial (serial),
  KEY idx_pubcert_email_created (email_norm, created_at),
  KEY idx_pubcert_phone_created (phone_norm, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS certificate_link_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  link_id BIGINT UNSIGNED NOT NULL,
  public_certificate_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  serial INT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL,
  email_norm VARCHAR(190) NOT NULL,
  phone VARCHAR(32) NULL,
  phone_norm VARCHAR(32) NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  utm_source VARCHAR(190) NULL,
  utm_medium VARCHAR(190) NULL,
  utm_campaign VARCHAR(190) NULL,
  download_count INT UNSIGNED NOT NULL DEFAULT 1,
  last_claimed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_claim_link_email (link_id, email_norm),
  KEY idx_claim_ip_created (ip, created_at),
  KEY idx_claim_link_created (link_id, created_at),
  KEY idx_claim_phone_created (phone_norm, created_at),
  KEY idx_claim_email (email_norm),
  KEY idx_claim_pubcert (public_certificate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
