-- Site-wide settings (tracking HTML, display-ads JSON, future keys). Run on studycafe MySQL.
CREATE TABLE IF NOT EXISTS global_settings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(128) NOT NULL,
  setting_value LONGTEXT NULL,
  meta JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_global_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Move display ads from footer_data (idempotent: only if global row missing)
INSERT INTO global_settings (setting_key, setting_value, meta, created_at, updated_at)
SELECT 'site_display_ads', fd.data_value, fd.meta, NOW(), NOW()
FROM footer_data fd
WHERE fd.data_key = 'site_display_ads'
  AND NOT EXISTS (SELECT 1 FROM global_settings g WHERE g.setting_key = 'site_display_ads')
LIMIT 1;

-- Optional: stop duplicating in footer payload (uncomment after verifying site-ads work)
-- DELETE FROM footer_data WHERE data_key = 'site_display_ads';

-- Optional: copy tracking snippets from legacy course page settings table (if it exists)
-- INSERT INTO global_settings (setting_key, setting_value, created_at, updated_at)
-- SELECT c.setting_key, c.setting_value, NOW(), NOW()
-- FROM sc_course_page_settings c
-- WHERE c.setting_key IN ('tracking_meta_pixel', 'tracking_google_analytics', 'tracking_linkedin_pixel')
--   AND NOT EXISTS (SELECT 1 FROM global_settings g WHERE g.setting_key = c.setting_key);
