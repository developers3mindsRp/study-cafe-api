const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const { logger } = require('../../../../shared');

/**
 * The single global certificate serial allocator, shared by BOTH ledgers:
 *   - course_certificates  (learners who completed a course)
 *   - public_certificates  (anonymous claims through an admin-issued certificate link)
 *
 * Serials are one platform-wide running sequence — they never restart per course and never collide
 * across the two ledgers, because every allocation goes through the same row-locked
 * certificate_counter row.
 *
 * Three invariants, all load-bearing:
 *
 *  1. allocateNextSerial() runs INSIDE the caller's transaction. On a duplicate-key rollback the
 *     counter increment rolls back with it, so a race never burns a serial. Never move the counter
 *     update out of the transaction.
 *  2. `UPDATE certificate_counter ... WHERE id = 1` holds a row lock for the rest of the
 *     transaction, serializing every allocation platform-wide. NEVER put a network call (HTTP,
 *     email, anything) inside it. Callers must resolve everything they need — link, course,
 *     throttle buckets — before calling assignSerial().
 *  3. Lock order across the public claim path is
 *     certificate_links -> certificate_counter -> public_certificates -> certificate_link_claims.
 */

/**
 * First certificate serial issued platform-wide. The global counter is seeded at START_SERIAL - 1
 * (see create-course-certificates-table.sql), so the first allocation returns exactly this value.
 * Change here AND in the seed value if the client wants a different starting number.
 */
const START_SERIAL = 5000;

/** Single-row counter id (see certificate_counter table). */
const COUNTER_ID = 1;

/** Prefix shown before the serial number on certificates (e.g. "SC-5000"). */
const SERIAL_PREFIX = 'SC-';

/** How many times to retry the allocation transaction after a duplicate-key race. */
const MAX_ATTEMPTS = 5;

/** Global running number → display serial with prefix (e.g. 5000 → "SC-5000"). */
function formatCertificateSerial(seq) {
  const n = Number(seq);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${SERIAL_PREFIX}${String(n).padStart(4, '0')}`;
}

function isDuplicateKeyError(err) {
  return (
    err?.original?.code === 'ER_DUP_ENTRY' ||
    err?.parent?.code === 'ER_DUP_ENTRY' ||
    err?.name === 'SequelizeUniqueConstraintError'
  );
}

/**
 * Allocate the next global serial atomically. The single-row UPDATE takes a row lock, so concurrent
 * callers are serialized and can never receive the same number. Falls back to seeding if the counter
 * row is somehow missing.
 */
async function allocateNextSerial(t) {
  await sequelize.query(
    `UPDATE certificate_counter SET current_serial = current_serial + 1 WHERE id = :id`,
    { replacements: { id: COUNTER_ID }, type: QueryTypes.UPDATE, transaction: t }
  );
  const rows = await sequelize.query(
    `SELECT current_serial FROM certificate_counter WHERE id = :id LIMIT 1`,
    { replacements: { id: COUNTER_ID }, type: QueryTypes.SELECT, transaction: t }
  );
  if (rows[0]?.current_serial != null) return Number(rows[0].current_serial);

  // Counter row missing (fresh/damaged) — seed it at START_SERIAL and return that.
  await sequelize.query(
    `INSERT INTO certificate_counter (id, current_serial) VALUES (:id, :seed)
     ON DUPLICATE KEY UPDATE current_serial = current_serial + 1`,
    { replacements: { id: COUNTER_ID, seed: START_SERIAL }, type: QueryTypes.INSERT, transaction: t }
  );
  const again = await sequelize.query(
    `SELECT current_serial FROM certificate_counter WHERE id = :id LIMIT 1`,
    { replacements: { id: COUNTER_ID }, type: QueryTypes.SELECT, transaction: t }
  );
  return Number(again[0]?.current_serial || START_SERIAL);
}

/**
 * Get-or-assign a global serial for whatever identity the caller owns.
 *
 * Stable by construction: the caller's own unique key (learners: `(user_id, course_id)`; public
 * claims: `(course_id, email_norm)`) is what makes a re-call return the same serial without ever
 * advancing the counter. A duplicate-key error from a concurrent first-claim is caught, the row is
 * re-read, and the rolled-back attempt costs nothing.
 *
 * @param {object}   opts
 * @param {(t: import('sequelize').Transaction|null) => Promise<number|null>} opts.readExisting
 *        "Do I already have one?" — called once outside any transaction for the fast path, then
 *        again inside the transaction as the race guard.
 * @param {(t: import('sequelize').Transaction) => Promise<void>} [opts.beforeAllocate]
 *        Optional hook run inside the transaction before the counter is touched. The public claim
 *        path uses it for the per-link cap; throwing from here rolls the whole attempt back.
 * @param {(serial: number, t: import('sequelize').Transaction) => Promise<void>} opts.insertWithSerial
 *        Caller's INSERT(s) for the allocated serial.
 * @param {object} [opts.context] Logged if every attempt loses the race.
 * @returns {Promise<number|null>} the serial, or null if it could not be resolved at all.
 */
async function assignSerial({ readExisting, beforeAllocate, insertWithSerial, context = {} }) {
  const existing = await readExisting(null);
  if (existing != null) return existing;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await sequelize.transaction(async (t) => {
        // Guard against a concurrent first-claim for the SAME identity having already inserted.
        const already = await readExisting(t);
        if (already != null) return already;

        if (beforeAllocate) await beforeAllocate(t);

        const next = await allocateNextSerial(t);
        await insertWithSerial(next, t);
        return next;
      });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Another request claimed this identity first — re-read and use its serial.
      const now = await readExisting(null);
      if (now != null) return now;
    }
  }

  logger.warn('[certificate] could not assign certificate serial after retries', context);
  // Last resort: return whatever exists (may be null); caller renders "—".
  return readExisting(null);
}

module.exports = {
  START_SERIAL,
  COUNTER_ID,
  SERIAL_PREFIX,
  formatCertificateSerial,
  isDuplicateKeyError,
  allocateNextSerial,
  assignSerial,
};
