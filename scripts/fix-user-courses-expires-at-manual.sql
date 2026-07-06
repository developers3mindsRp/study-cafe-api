-- =============================================================================
-- MANUAL FIX: user_courses.expires_at corrupted to migration sentinel 2000-01-01
-- =============================================================================
--
-- SAFETY RULES (read before running anything):
--   • Run every SELECT / PREVIEW step first; review output before any UPDATE.
--   • Take a backup (Step 0) before applying the fix.
--   • This script ONLY touches user_courses rows where expires_at = '2000-01-01'.
--   • Legacy WP orders with wp_post_status = 'draft' (intentionally expired) are
--     EXCLUDED and keep 2000-01-01 unchanged.
--   • No other tables are modified.
--   • Do NOT run migrate:wp-to-ms or any automated migration alongside this.
--
-- Correct expires_at logic (matches order-service / outbox worker):
--   courses.validity = 'lifetime'  → expires_at = NULL
--   courses.validity = '1year' (or missing column) → purchase_date + 1 YEAR
--
-- Purchase date = created_at of the latest *active-granting* paid course order:
--   native order  (wp_post_status IS NULL)  OR
--   legacy active (wp_post_status = 'publish')
-- Fallback: enrollments.enrolled_at when no matching order row exists.
-- Admin-granted rows (order_id IS NULL): expires_at = NULL (no purchase date).
-- =============================================================================


-- =============================================================================
-- STEP 0 — PREFLIGHT & BACKUP (required)
-- =============================================================================

-- 0a. Confirm courses.validity column exists (added by migrate-course-validity.sql).
--     If this returns 0, stop — run migrate-course-validity.sql first (schema only).
SELECT COUNT(*) AS validity_column_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'courses'
  AND COLUMN_NAME = 'validity';

-- 0b. Confirm orders.deleted_at exists (soft-delete). If 0, remove "AND (o.deleted_at IS NULL)"
--     from all order subqueries below before running.
SELECT COUNT(*) AS orders_deleted_at_exists
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'orders'
  AND COLUMN_NAME = 'deleted_at';

-- =============================================================================
-- STEP 0 — BACKUP (required)
-- =============================================================================
-- Run once. Confirms row count before backup.

SELECT COUNT(*) AS user_courses_total FROM user_courses;

CREATE TABLE IF NOT EXISTS user_courses_backup_expires_fix AS
SELECT * FROM user_courses;

SELECT COUNT(*) AS backup_rows FROM user_courses_backup_expires_fix;


-- =============================================================================
-- STEP 1 — IDENTIFY AFFECTED RECORDS
-- =============================================================================

-- 1a. Distribution of expires_at (baseline)
SELECT
  CASE
    WHEN expires_at IS NULL THEN 'NULL (active/lifetime)'
    WHEN expires_at = '2000-01-01 00:00:00' THEN '2000-01-01 (migration sentinel — suspect)'
    WHEN expires_at <= NOW() THEN 'past date (legitimately expired)'
    ELSE 'future date (legitimately active)'
  END AS expiry_bucket,
  COUNT(*) AS row_count
FROM user_courses
GROUP BY expiry_bucket
ORDER BY row_count DESC;


-- 1b. Suspect rows only (migration sentinel)
SELECT COUNT(*) AS suspect_sentinel_rows
FROM user_courses
WHERE expires_at = '2000-01-01 00:00:00';


-- 1c. Suspect rows broken down by whether they should stay expired (legacy draft)
--     "should_fix" = YES  → safe to recalculate
--     "should_fix" = NO   → legacy draft-only; leave 2000-01-01 untouched
SELECT
  CASE
    WHEN uc.order_id IS NULL THEN 'admin_granted'
    WHEN bp.user_id IS NOT NULL THEN 'has_active_paid_order'
    WHEN en.user_id IS NOT NULL THEN 'enrollment_fallback_only'
    WHEN draft_only.user_id IS NOT NULL THEN 'legacy_draft_only_DO_NOT_FIX'
    ELSE 'no_order_evidence_review_manually'
  END AS fix_category,
  COUNT(*) AS row_count
FROM user_courses uc
LEFT JOIN (
  -- Latest active-granting paid course order per (user, course)
  SELECT
    o.user_id,
    COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id,
    MAX(o.created_at) AS purchase_at
  FROM orders o
  WHERE o.type = 'course'
    AND o.status IN ('paid', 'completed')
    AND (o.deleted_at IS NULL)
    AND (o.wp_post_status IS NULL OR o.wp_post_status = 'publish')
  GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
) bp ON bp.user_id = uc.user_id AND bp.course_id = uc.course_id
LEFT JOIN (
  SELECT e.user_id, e.course_id, MAX(e.enrolled_at) AS enrolled_at
  FROM enrollments e
  GROUP BY e.user_id, e.course_id
) en ON en.user_id = uc.user_id AND en.course_id = uc.course_id
LEFT JOIN (
  -- User/course pairs with paid orders but ONLY legacy draft (intentionally expired)
  SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
  FROM orders o
  WHERE o.type = 'course'
    AND o.status IN ('paid', 'completed')
    AND (o.deleted_at IS NULL)
  GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
     AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
) draft_only ON draft_only.user_id = uc.user_id AND draft_only.course_id = uc.course_id
WHERE uc.expires_at = '2000-01-01 00:00:00'
GROUP BY fix_category
ORDER BY row_count DESC;


-- 1d. Sample detail for manual review (first 100 fixable rows)
SELECT
  uc.user_id,
  uc.course_id,
  uc.order_id AS uc_order_id,
  uc.expires_at AS current_expires_at,
  COALESCE(c.validity, '1year') AS course_validity,
  bp.purchase_at AS order_purchase_at,
  en.enrolled_at AS enrollment_fallback_at,
  COALESCE(bp.purchase_at, en.enrolled_at) AS resolved_purchase_at,
  CASE
    WHEN uc.order_id IS NULL THEN NULL
    WHEN COALESCE(c.validity, '1year') = 'lifetime' THEN NULL
    ELSE DATE_ADD(COALESCE(bp.purchase_at, en.enrolled_at), INTERVAL 1 YEAR)
  END AS proposed_expires_at,
  CASE
    WHEN draft_only.user_id IS NOT NULL THEN 'SKIP — legacy draft only'
    WHEN uc.order_id IS NULL THEN 'FIX — admin granted'
    WHEN bp.user_id IS NOT NULL OR en.user_id IS NOT NULL THEN 'FIX — recalculate'
    ELSE 'REVIEW — no purchase evidence'
  END AS action
FROM user_courses uc
LEFT JOIN courses c ON c.id = uc.course_id
LEFT JOIN (
  SELECT
    o.user_id,
    COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id,
    MAX(o.created_at) AS purchase_at
  FROM orders o
  WHERE o.type = 'course'
    AND o.status IN ('paid', 'completed')
    AND (o.deleted_at IS NULL)
    AND (o.wp_post_status IS NULL OR o.wp_post_status = 'publish')
  GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
) bp ON bp.user_id = uc.user_id AND bp.course_id = uc.course_id
LEFT JOIN (
  SELECT e.user_id, e.course_id, MAX(e.enrolled_at) AS enrolled_at
  FROM enrollments e
  GROUP BY e.user_id, e.course_id
) en ON en.user_id = uc.user_id AND en.course_id = uc.course_id
LEFT JOIN (
  SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
  FROM orders o
  WHERE o.type = 'course'
    AND o.status IN ('paid', 'completed')
    AND (o.deleted_at IS NULL)
  GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
     AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
) draft_only ON draft_only.user_id = uc.user_id AND draft_only.course_id = uc.course_id
WHERE uc.expires_at = '2000-01-01 00:00:00'
  AND draft_only.user_id IS NULL
  AND (uc.order_id IS NULL OR bp.user_id IS NOT NULL OR en.user_id IS NOT NULL)
ORDER BY uc.user_id, uc.course_id
LIMIT 100;


-- 1e. Rows that will NOT be updated (legacy draft-only — confirm count is expected)
SELECT
  uc.user_id,
  uc.course_id,
  uc.order_id,
  o.wp_post_status,
  o.status,
  o.created_at AS order_created_at
FROM user_courses uc
INNER JOIN (
  SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
  FROM orders o
  WHERE o.type = 'course'
    AND o.status IN ('paid', 'completed')
    AND (o.deleted_at IS NULL)
  GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
     AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
) draft_only ON draft_only.user_id = uc.user_id AND draft_only.course_id = uc.course_id
LEFT JOIN orders o ON o.user_id = uc.user_id
  AND COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) = uc.course_id
  AND o.type = 'course'
WHERE uc.expires_at = '2000-01-01 00:00:00'
LIMIT 100;


-- 1f. Spot-check a specific user (replace user_id as needed)
-- SET @check_user_id = 138663;
SELECT
  uc.user_id,
  uc.course_id,
  uc.order_id,
  uc.expires_at,
  c.validity,
  o.id AS order_pk,
  o.wp_post_status,
  o.status,
  o.created_at AS purchase_date,
  CASE
    WHEN COALESCE(c.validity, '1year') = 'lifetime' THEN NULL
    ELSE DATE_ADD(o.created_at, INTERVAL 1 YEAR)
  END AS expected_expires_at
FROM user_courses uc
LEFT JOIN courses c ON c.id = uc.course_id
LEFT JOIN orders o ON o.user_id = uc.user_id
  AND o.type = 'course'
  AND o.status IN ('paid', 'completed')
  AND (o.deleted_at IS NULL)
  AND COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) = uc.course_id
WHERE uc.user_id = 138663;


-- =============================================================================
-- STEP 2 — PREVIEW THE FIX (no writes)
-- =============================================================================
-- Shows current vs proposed for every row that WOULD be updated.

SELECT
  uc.user_id,
  uc.course_id,
  uc.expires_at AS current_expires_at,
  fix.proposed_expires_at,
  fix.purchase_at,
  fix.course_validity,
  fix.fix_reason
FROM user_courses uc
INNER JOIN (
  SELECT
    uc2.user_id,
    uc2.course_id,
    COALESCE(c.validity, '1year') AS course_validity,
    COALESCE(bp.purchase_at, en.enrolled_at) AS purchase_at,
    CASE
      WHEN uc2.order_id IS NULL THEN NULL
      WHEN COALESCE(c.validity, '1year') = 'lifetime' THEN NULL
      ELSE DATE_ADD(COALESCE(bp.purchase_at, en.enrolled_at), INTERVAL 1 YEAR)
    END AS proposed_expires_at,
    CASE
      WHEN uc2.order_id IS NULL THEN 'admin_granted'
      WHEN bp.purchase_at IS NOT NULL THEN 'paid_order'
      ELSE 'enrollment_fallback'
    END AS fix_reason
  FROM user_courses uc2
  LEFT JOIN courses c ON c.id = uc2.course_id
  LEFT JOIN (
    SELECT
      o.user_id,
      COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id,
      MAX(o.created_at) AS purchase_at
    FROM orders o
    WHERE o.type = 'course'
      AND o.status IN ('paid', 'completed')
      AND (o.deleted_at IS NULL)
      AND (o.wp_post_status IS NULL OR o.wp_post_status = 'publish')
    GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  ) bp ON bp.user_id = uc2.user_id AND bp.course_id = uc2.course_id
  LEFT JOIN (
    SELECT e.user_id, e.course_id, MAX(e.enrolled_at) AS enrolled_at
    FROM enrollments e
    GROUP BY e.user_id, e.course_id
  ) en ON en.user_id = uc2.user_id AND en.course_id = uc2.course_id
  LEFT JOIN (
    SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
    FROM orders o
    WHERE o.type = 'course'
      AND o.status IN ('paid', 'completed')
      AND (o.deleted_at IS NULL)
    GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
    HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
       AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
  ) draft_only ON draft_only.user_id = uc2.user_id AND draft_only.course_id = uc2.course_id
  WHERE uc2.expires_at = '2000-01-01 00:00:00'
    AND draft_only.user_id IS NULL
    AND (
      uc2.order_id IS NULL
      OR bp.purchase_at IS NOT NULL
      OR en.enrolled_at IS NOT NULL
    )
) fix ON fix.user_id = uc.user_id AND fix.course_id = uc.course_id
ORDER BY uc.user_id, uc.course_id;


-- Count rows that will change
SELECT COUNT(*) AS rows_to_update
FROM user_courses uc
INNER JOIN (
  SELECT uc2.user_id, uc2.course_id
  FROM user_courses uc2
  LEFT JOIN (
    SELECT
      o.user_id,
      COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id,
      MAX(o.created_at) AS purchase_at
    FROM orders o
    WHERE o.type = 'course'
      AND o.status IN ('paid', 'completed')
      AND (o.deleted_at IS NULL)
      AND (o.wp_post_status IS NULL OR o.wp_post_status = 'publish')
    GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  ) bp ON bp.user_id = uc2.user_id AND bp.course_id = uc2.course_id
  LEFT JOIN (
    SELECT e.user_id, e.course_id, MAX(e.enrolled_at) AS enrolled_at
    FROM enrollments e
    GROUP BY e.user_id, e.course_id
  ) en ON en.user_id = uc2.user_id AND en.course_id = uc2.course_id
  LEFT JOIN (
    SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
    FROM orders o
    WHERE o.type = 'course'
      AND o.status IN ('paid', 'completed')
      AND (o.deleted_at IS NULL)
    GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
    HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
       AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
  ) draft_only ON draft_only.user_id = uc2.user_id AND draft_only.course_id = uc2.course_id
  WHERE uc2.expires_at = '2000-01-01 00:00:00'
    AND draft_only.user_id IS NULL
    AND (uc2.order_id IS NULL OR bp.purchase_at IS NOT NULL OR en.enrolled_at IS NOT NULL)
) eligible ON eligible.user_id = uc.user_id AND eligible.course_id = uc.course_id;


-- =============================================================================
-- STEP 3 — APPLY FIX (run ONLY after Step 2 preview looks correct)
-- =============================================================================
-- Scope: user_courses ONLY, expires_at ONLY, sentinel value ONLY.
-- Expected: row count matches rows_to_update from Step 2.

START TRANSACTION;

UPDATE user_courses uc
INNER JOIN (
  SELECT
    uc2.user_id,
    uc2.course_id,
    CASE
      WHEN uc2.order_id IS NULL THEN NULL
      WHEN COALESCE(c.validity, '1year') = 'lifetime' THEN NULL
      ELSE DATE_ADD(COALESCE(bp.purchase_at, en.enrolled_at), INTERVAL 1 YEAR)
    END AS new_expires_at
  FROM user_courses uc2
  LEFT JOIN courses c ON c.id = uc2.course_id
  LEFT JOIN (
    SELECT
      o.user_id,
      COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id,
      MAX(o.created_at) AS purchase_at
    FROM orders o
    WHERE o.type = 'course'
      AND o.status IN ('paid', 'completed')
      AND (o.deleted_at IS NULL)
      AND (o.wp_post_status IS NULL OR o.wp_post_status = 'publish')
    GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  ) bp ON bp.user_id = uc2.user_id AND bp.course_id = uc2.course_id
  LEFT JOIN (
    SELECT e.user_id, e.course_id, MAX(e.enrolled_at) AS enrolled_at
    FROM enrollments e
    GROUP BY e.user_id, e.course_id
  ) en ON en.user_id = uc2.user_id AND en.course_id = uc2.course_id
  LEFT JOIN (
    SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
    FROM orders o
    WHERE o.type = 'course'
      AND o.status IN ('paid', 'completed')
      AND (o.deleted_at IS NULL)
    GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
    HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
       AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
  ) draft_only ON draft_only.user_id = uc2.user_id AND draft_only.course_id = uc2.course_id
  WHERE uc2.expires_at = '2000-01-01 00:00:00'
    AND draft_only.user_id IS NULL
    AND (
      uc2.order_id IS NULL
      OR bp.purchase_at IS NOT NULL
      OR en.enrolled_at IS NOT NULL
    )
) calc ON calc.user_id = uc.user_id AND calc.course_id = uc.course_id
SET uc.expires_at = calc.new_expires_at
WHERE uc.expires_at = '2000-01-01 00:00:00';

-- Verify inside transaction before COMMIT
SELECT ROW_COUNT() AS updated_rows;

SELECT
  CASE
    WHEN expires_at IS NULL THEN 'NULL'
    WHEN expires_at = '2000-01-01 00:00:00' THEN 'still_sentinel'
    WHEN expires_at <= NOW() THEN 'past_expired'
    ELSE 'future_active'
  END AS bucket,
  COUNT(*) AS cnt
FROM user_courses
GROUP BY bucket;

-- If anything looks wrong:
-- ROLLBACK;
-- Otherwise:
COMMIT;


-- =============================================================================
-- STEP 4 — POST-FIX VERIFICATION
-- =============================================================================

-- Should be 0 (or only legacy draft-only rows you intentionally skipped)
SELECT COUNT(*) AS remaining_sentinel_fixable
FROM user_courses uc
LEFT JOIN (
  SELECT o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id) AS course_id
  FROM orders o
  WHERE o.type = 'course'
    AND o.status IN ('paid', 'completed')
    AND (o.deleted_at IS NULL)
  GROUP BY o.user_id, COALESCE(CAST(NULLIF(TRIM(o.entity_id), '') AS UNSIGNED), o.course_id)
  HAVING SUM(CASE WHEN o.wp_post_status IS NULL OR o.wp_post_status = 'publish' THEN 1 ELSE 0 END) = 0
     AND SUM(CASE WHEN o.wp_post_status = 'draft' THEN 1 ELSE 0 END) > 0
) draft_only ON draft_only.user_id = uc.user_id AND draft_only.course_id = uc.course_id
WHERE uc.expires_at = '2000-01-01 00:00:00'
  AND draft_only.user_id IS NULL;


-- =============================================================================
-- ROLLBACK (if already committed and need to undo)
-- =============================================================================
-- UPDATE user_courses uc
-- INNER JOIN user_courses_backup_expires_fix b
--   ON b.user_id = uc.user_id AND b.course_id = uc.course_id
-- SET uc.expires_at = b.expires_at;
