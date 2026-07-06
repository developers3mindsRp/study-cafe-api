#!/usr/bin/env node
'use strict';

/**
 * One-time runner for fix-user-courses-expires-at-manual.sql
 * Usage: node scripts/run-fix-user-courses-expires-at.js [--dry-run]
 */
const { Sequelize } = require('sequelize');
const { migrationTgtConfig } = require('../shared/env');

const dryRun = process.argv.includes('--dry-run');
const BACKUP_TABLE = 'user_courses_backup_expires_fix_20260703';

const UPDATE_SQL = `
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
WHERE uc.expires_at = '2000-01-01 00:00:00'
`;

const COUNT_ELIGIBLE_SQL = `
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
) eligible ON eligible.user_id = uc.user_id AND eligible.course_id = uc.course_id
`;

async function main() {
  const cfg = migrationTgtConfig();
  const db = new Sequelize(cfg.database, cfg.user, cfg.password, {
    host: cfg.host,
    port: cfg.port,
    dialect: 'mysql',
    logging: false,
  });

  await db.authenticate();
  console.log(`Connected to ${cfg.host}:${cfg.port}/${cfg.database}`);
  if (dryRun) console.log('DRY RUN — no writes\n');

  const [[{ total }]] = await db.query('SELECT COUNT(*) AS total FROM user_courses');
  const [[{ sentinel }]] = await db.query(
    "SELECT COUNT(*) AS sentinel FROM user_courses WHERE expires_at = '2000-01-01 00:00:00'"
  );
  console.log(`user_courses total: ${total}`);
  console.log(`sentinel rows (2000-01-01): ${sentinel}`);

  const [[{ rows_to_update: eligible }]] = await db.query(COUNT_ELIGIBLE_SQL);
  console.log(`rows eligible for fix: ${eligible}`);

  if (dryRun) {
    await db.close();
    return;
  }

  const [[existing]] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t`,
    { replacements: { t: BACKUP_TABLE } }
  );
  if (Number(existing.c) > 0) {
    console.log(`Backup table ${BACKUP_TABLE} already exists — skipping backup create`);
  } else {
    await db.query(`CREATE TABLE \`${BACKUP_TABLE}\` AS SELECT * FROM user_courses`);
    const [[{ backup_rows }]] = await db.query(`SELECT COUNT(*) AS backup_rows FROM \`${BACKUP_TABLE}\``);
    console.log(`Backup created: ${BACKUP_TABLE} (${backup_rows} rows)`);
  }

  const t = await db.transaction();
  try {
    const [, meta] = await db.query(UPDATE_SQL, { transaction: t });
    const updated = meta?.affectedRows ?? meta;
    console.log(`Updated rows: ${updated}`);

    const [buckets] = await db.query(
      `SELECT
        CASE
          WHEN expires_at IS NULL THEN 'NULL'
          WHEN expires_at = '2000-01-01 00:00:00' THEN 'still_sentinel'
          WHEN expires_at <= NOW() THEN 'past_expired'
          ELSE 'future_active'
        END AS bucket,
        COUNT(*) AS cnt
      FROM user_courses
      GROUP BY bucket`,
      { transaction: t }
    );
    console.log('Post-update distribution:', buckets);

    const [[{ remaining }]] = await db.query(
      `SELECT COUNT(*) AS remaining
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
         AND draft_only.user_id IS NULL`,
      { transaction: t }
    );
    console.log(`Remaining fixable sentinel rows: ${remaining}`);

    if (Number(updated) !== Number(eligible)) {
      console.warn(`WARNING: updated (${updated}) != eligible (${eligible}) — rolling back`);
      await t.rollback();
      process.exitCode = 1;
      return;
    }

    await t.commit();
    console.log('COMMIT successful');
    console.log(`Rollback: UPDATE user_courses uc INNER JOIN ${BACKUP_TABLE} b ON b.user_id=uc.user_id AND b.course_id=uc.course_id SET uc.expires_at=b.expires_at`);
  } catch (err) {
    await t.rollback();
    throw err;
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
