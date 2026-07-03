-- Idempotent: add index on users.role_id only if missing.
-- Speeds up role user-count aggregation (GROUP BY role_id) on the roles listing API,
-- which otherwise full-scans the users table.
SET @dbname = DATABASE();
SET @tablename = 'users';
SET @indexname = 'idx_users_role_id';
SET @preparedStatement = (SELECT IF(
  (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = @dbname
      AND TABLE_NAME = @tablename
      AND INDEX_NAME = @indexname
  ) > 0,
  'SELECT 1',
  CONCAT('ALTER TABLE `', @tablename, '` ADD INDEX `', @indexname, '` (`role_id`)')
));
PREPARE addIndexIfNotExists FROM @preparedStatement;
EXECUTE addIndexIfNotExists;
DEALLOCATE PREPARE addIndexIfNotExists;
