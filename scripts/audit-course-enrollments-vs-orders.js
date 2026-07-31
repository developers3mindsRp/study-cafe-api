#!/usr/bin/env node
/**
 * Reconcile a course's ENROLLMENT count against its ORDER count and explain every
 * row of the difference.
 *
 * The two numbers are counted on different keys and can never be compared directly:
 *   - "Enrolled Students" on a batch  = COUNT(batch_enrollments) for ONE batch, unique per (batch_id, user_id)
 *   - "Orders" filtered by course     = COUNT(orders) for the WHOLE course, one row per order, ALL statuses
 * So one learner with two orders counts once on the left and twice on the right, and a
 * learner sitting in another batch of the same course counts zero on the left.
 *
 * Usage:
 *   node scripts/audit-course-enrollments-vs-orders.js --course 424948
 *   node scripts/audit-course-enrollments-vs-orders.js --batch 224
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const { Sequelize, QueryTypes } = require('sequelize');
const { migrationTgtConfig } = require('../shared/env');

const TGT = migrationTgtConfig();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

function table(rows) {
  if (!rows || rows.length === 0) {
    console.log('  (none)');
    return;
  }
  console.table(rows);
}

async function main() {
  const batchArg = arg('batch');
  const courseArg = arg('course');
  if (!batchArg && !courseArg) {
    console.error('Pass --course <id> or --batch <id>');
    process.exit(1);
  }

  const db = new Sequelize(TGT.database, TGT.user, TGT.password, {
    host: TGT.host, port: TGT.port, dialect: 'mysql', logging: false,
  });
  await db.authenticate();
  const q = (sql, replacements) => db.query(sql, { replacements, type: QueryTypes.SELECT });

  let courseId = courseArg ? Number(courseArg) : null;
  if (!courseId) {
    const [b] = await q('SELECT course_id FROM batches WHERE id = :id', { id: Number(batchArg) });
    if (!b) { console.error(`Batch ${batchArg} not found`); process.exit(1); }
    courseId = Number(b.course_id);
  }
  // entity_id is a VARCHAR on orders — always compare as a string, never CAST (mixes collations).
  const cidStr = String(courseId);

  const [course] = await q('SELECT id, title, slug, validity FROM courses WHERE id = :id', { id: courseId });
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' ENROLLMENTS vs ORDERS AUDIT');
  console.log(' DB     :', `${TGT.host}/${TGT.database}`);
  console.log(' COURSE :', courseId, '—', course ? course.title : '(course row missing)');
  console.log('══════════════════════════════════════════════════════════════════\n');

  console.log('── BATCHES OF THIS COURSE (enrollments are counted PER BATCH) ──');
  table(await q(
    `SELECT b.id AS batch_id, b.name, b.start_date, b.end_date,
            (SELECT COUNT(*) FROM sessions s WHERE s.batch_id = b.id) AS sessions,
            (SELECT COUNT(*) FROM batch_enrollments be WHERE be.batch_id = b.id) AS enrolled
       FROM batches b WHERE b.course_id = :cid ORDER BY b.id`,
    { cid: courseId },
  ));

  console.log('\n── ENROLLMENT TOTALS ──');
  table(await q(
    `SELECT
       (SELECT COUNT(*) FROM batch_enrollments be JOIN batches b ON b.id = be.batch_id
         WHERE b.course_id = :cid) AS batch_enrollments_all_batches,
       (SELECT COUNT(DISTINCT be.user_id) FROM batch_enrollments be JOIN batches b ON b.id = be.batch_id
         WHERE b.course_id = :cid) AS distinct_enrolled_users,
       (SELECT COUNT(*) FROM enrollments WHERE course_id = :cid) AS course_level_enrollments,
       (SELECT COUNT(*) FROM user_courses WHERE course_id = :cid) AS user_courses_access_grants`,
    { cid: courseId },
  ));

  console.log('\n── ORDER TOTALS (type=course, entity_id=courseId) ──');
  table(await q(
    `SELECT COUNT(*) AS all_rows,
            SUM(deleted_at IS NULL) AS live_rows,
            SUM(deleted_at IS NOT NULL) AS trashed_rows,
            SUM(deleted_at IS NULL AND status IN ('paid','completed')) AS live_paid_rows,
            COUNT(DISTINCT CASE WHEN deleted_at IS NULL AND status IN ('paid','completed')
                                THEN user_id END) AS distinct_paid_users
       FROM orders WHERE type = 'course' AND entity_id = :cid`,
    { cid: cidStr },
  ));

  console.log('\n── ORDERS BY STATUS (the Orders screen shows ALL statuses by default) ──');
  table(await q(
    `SELECT status, COUNT(*) AS orders, SUM(deleted_at IS NOT NULL) AS trashed
       FROM orders WHERE type = 'course' AND entity_id = :cid GROUP BY status ORDER BY orders DESC`,
    { cid: cidStr },
  ));

  console.log('\n── CAUSE A: users with MORE THAN ONE live paid order (orders > enrollments) ──');
  table(await q(
    `SELECT user_id, COUNT(*) AS paid_orders, GROUP_CONCAT(order_id) AS order_ids,
            GROUP_CONCAT(amount) AS amounts
       FROM orders WHERE type = 'course' AND entity_id = :cid
         AND deleted_at IS NULL AND status IN ('paid','completed')
       GROUP BY user_id HAVING COUNT(*) > 1`,
    { cid: cidStr },
  ));

  console.log('\n── CAUSE B: enrolled but NO live paid course order (enrollments > orders) ──');
  console.log('   membership_orders > 0 → membership/plan access. trashed_orders > 0 → order was deleted.');
  table(await q(
    `SELECT be.user_id, b.id AS batch_id, b.name AS batch_name, be.enrolled_at,
            (SELECT COUNT(*) FROM orders o WHERE o.type='course' AND o.entity_id = :cidStr
              AND o.user_id = be.user_id) AS course_order_rows_any_state,
            (SELECT COUNT(*) FROM orders o WHERE o.type='course' AND o.entity_id = :cidStr
              AND o.user_id = be.user_id AND o.deleted_at IS NOT NULL) AS trashed_orders,
            (SELECT COUNT(*) FROM orders o WHERE o.type='membership' AND o.user_id = be.user_id
              AND o.deleted_at IS NULL AND o.status IN ('paid','completed')) AS membership_orders,
            (SELECT COUNT(*) FROM user_courses uc WHERE uc.user_id = be.user_id
              AND uc.course_id = :cid) AS access_grant_rows
       FROM batch_enrollments be JOIN batches b ON b.id = be.batch_id
      WHERE b.course_id = :cid
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.type='course' AND o.entity_id = :cidStr
                          AND o.user_id = be.user_id AND o.deleted_at IS NULL
                          AND o.status IN ('paid','completed'))
      ORDER BY be.enrolled_at`,
    { cid: courseId, cidStr },
  ));

  console.log('\n── CAUSE C: live paid order but NO batch enrollment in ANY batch ──');
  console.log('   Usually an order placed while the course had zero batches — never backfilled.');
  table(await q(
    `SELECT o.user_id, o.order_id, o.status, o.amount, o.batch_id AS order_batch_id, o.created_at,
            (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = o.user_id
              AND e.course_id = :cid) AS course_enrollment_rows,
            (SELECT COUNT(*) FROM user_courses uc WHERE uc.user_id = o.user_id
              AND uc.course_id = :cid) AS access_grant_rows
       FROM orders o
      WHERE o.type = 'course' AND o.entity_id = :cidStr AND o.deleted_at IS NULL
        AND o.status IN ('paid','completed')
        AND NOT EXISTS (SELECT 1 FROM batch_enrollments be JOIN batches b ON b.id = be.batch_id
                         WHERE b.course_id = :cid AND be.user_id = o.user_id)
      ORDER BY o.created_at`,
    { cid: courseId, cidStr },
  ));

  console.log('\n── CAUSE D: refunded orders still listed on the Orders screen ──');
  table(await q(
    `SELECT o.user_id, o.order_id, o.status, o.refund_amount, o.created_at,
            EXISTS (SELECT 1 FROM batch_enrollments be JOIN batches b ON b.id = be.batch_id
                     WHERE b.course_id = :cid AND be.user_id = o.user_id) AS still_enrolled
       FROM orders o
      WHERE o.type = 'course' AND o.entity_id = :cidStr AND o.status = 'refunded'
      ORDER BY o.created_at`,
    { cid: courseId, cidStr },
  ));

  console.log('\n── OUTBOX HEALTH (a failed COURSE_PURCHASED = paid order that never enrolled) ──');
  table(await q(
    `SELECT event_type, status, COUNT(*) AS events
       FROM outbox_events
      WHERE JSON_UNQUOTE(JSON_EXTRACT(payload, '$.courseId')) = :cid
      GROUP BY event_type, status ORDER BY event_type, status`,
    { cid: cidStr },
  ));

  await db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
