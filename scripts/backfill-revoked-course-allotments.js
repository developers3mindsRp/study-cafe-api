#!/usr/bin/env node
/**
 * Repair course deallotments that were applied before `user_courses.revoked_at` existed.
 *
 * The first version of admin deallotment DELETED the `user_courses` row. A deleted row is
 * indistinguishable from a grant that was never written (order-service grants
 * asynchronously via the outbox worker), so those removals cannot hide the course from
 * the learner — the card stays in "Purchased Course" and the edit form keeps re-offering
 * the allotment.
 *
 * The admin audit log is the authoritative record of what was removed: every deallotment
 * writes a REMOVE_USER_COURSE row with resource_id '<userId>-<courseId>'. This replays
 * those entries, re-inserting each grant with `revoked_at` stamped so the removal reads
 * as an explicit revocation.
 *
 * Only rows that are currently ABSENT are written. A pair that has a live grant again was
 * re-allotted after the removal, so it is left alone — re-adding is the documented way to
 * undo a deallotment and this must not silently take the course back.
 *
 * Nothing is deleted, and no order or payment row is touched.
 *
 * Safe to re-run: a second pass finds the rows it wrote and skips them.
 *
 *   node scripts/backfill-revoked-course-allotments.js --dry-run
 *   node scripts/backfill-revoked-course-allotments.js
 */

'use strict';

const mysql = require('mysql2/promise');
const { mysqlConfig: getMysqlConfig } = require('../shared/env');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const { host, port, user, password, database } = getMysqlConfig();
  const conn = await mysql.createConnection({ host, port, user, password, database });

  try {
    const [cols] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_courses' AND COLUMN_NAME = 'revoked_at'`,
    );
    if (Number(cols[0]?.cnt) === 0) {
      throw new Error('user_courses.revoked_at is missing — run `npm run migrate:user-courses-revoked-at` first.');
    }

    // Earliest log entry per pair: the removal being repaired is the original one, and
    // its timestamp is a truer revoked_at than "now".
    const [logs] = await conn.query(
      `SELECT resource_id, MIN(created_at) AS revoked_at
         FROM admin_logs
        WHERE action = 'REMOVE_USER_COURSE'
        GROUP BY resource_id`,
    );

    let written = 0;
    let skippedExisting = 0;
    let skippedUnparsable = 0;

    for (const log of logs) {
      // resource_id is '<userId>-<courseId>'; both are numeric, so split on the last dash.
      const raw = String(log.resource_id || '');
      const idx = raw.lastIndexOf('-');
      const userId = Number(raw.slice(0, idx));
      const courseId = Number(raw.slice(idx + 1));
      if (!Number.isFinite(userId) || userId <= 0 || !Number.isFinite(courseId) || courseId <= 0) {
        console.warn(`skip (unparsable resource_id): ${raw}`);
        skippedUnparsable += 1;
        continue;
      }

      const [existing] = await conn.query(
        'SELECT revoked_at FROM user_courses WHERE user_id = ? AND course_id = ?',
        [userId, courseId],
      );
      if (existing.length > 0) {
        const state = existing[0].revoked_at ? 'already revoked' : 're-allotted since';
        console.log(`skip (${state}): user ${userId} course ${courseId}`);
        skippedExisting += 1;
        continue;
      }

      if (DRY_RUN) {
        console.log(`would write: user ${userId} course ${courseId} revoked_at=${log.revoked_at}`);
      } else {
        await conn.query(
          `INSERT INTO user_courses (user_id, course_id, order_id, expires_at, revoked_at)
           VALUES (?, ?, NULL, NULL, ?)`,
          [userId, courseId, log.revoked_at],
        );
        console.log(`revoked: user ${userId} course ${courseId}`);
      }
      written += 1;
    }

    console.log(
      `\n${DRY_RUN ? '[dry run] ' : ''}Done. ${DRY_RUN ? 'Would write' : 'Wrote'} ${written}, ` +
        `skipped ${skippedExisting} existing, ${skippedUnparsable} unparsable.`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
