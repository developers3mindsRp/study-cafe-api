-- Idempotent: add hide_from_public only if missing (fixes course list 500 when column was never migrated).
SET @dbname = DATABASE();
SET @tablename = 'courses';
SET @columnname = 'hide_from_public';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND COLUMN_NAME = @columnname
  ) > 0,
  'SELECT 1',
  CONCAT(
    'ALTER TABLE `', @tablename,
    '` ADD COLUMN `', @columnname,
    '` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_published`'
  )
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
