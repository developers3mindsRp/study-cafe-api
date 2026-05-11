-- Run once against the StudyCafe MySQL schema if saves for Global Settings / course page scripts fail
-- with "Data too long" (column was VARCHAR or TEXT instead of LONGTEXT).
ALTER TABLE sc_course_page_settings
  MODIFY COLUMN setting_value LONGTEXT NULL;
