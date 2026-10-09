-- Idempotent: add hide_from_public (unlisted memberships) only if missing.
-- Unlisted plans are excluded from GET /platform/memberships (pricing page, home, comparison table)
-- but still open and purchasable via /plans/<slug>. Run BEFORE deploying the API that reads this column.
SET @dbname = DATABASE();
SET @tablename = 'premium_plans';
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
    '` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`'
  )
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
