-- Per-course marketing landing pages (admin → Marketing pages).
CREATE TABLE IF NOT EXISTS marketing_pages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  slug VARCHAR(200) NOT NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  meta LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_marketing_pages_slug (slug),
  UNIQUE KEY uq_marketing_pages_course_id (course_id),
  KEY idx_marketing_pages_published (is_published)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
