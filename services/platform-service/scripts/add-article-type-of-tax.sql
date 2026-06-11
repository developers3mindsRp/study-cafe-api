-- Adds type_of_tax for article notification metadata (legacy WP tax_type meta).
-- Run against studycafe_db (adjust if your database name differs).

ALTER TABLE articles
  ADD COLUMN type_of_tax VARCHAR(100) NULL
    COMMENT 'Notification tax type (GST, Income Tax, etc.)'
    AFTER noti_date;
