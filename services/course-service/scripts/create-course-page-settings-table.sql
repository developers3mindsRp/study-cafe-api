-- Course-wide sections (alumni logos, featured-in, trending course ids). Run once on studycafe MySQL.
CREATE TABLE IF NOT EXISTS sc_course_page_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(100) NOT NULL,
  setting_value LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sc_course_page_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
