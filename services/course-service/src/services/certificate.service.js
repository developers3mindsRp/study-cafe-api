const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const coursesService = require('./courses.service');
const { checkCourseAccess } = require('./accessClient');
const { logger } = require('../../../../shared');

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

function courseProvidesCertificate(course) {
  if (!course) return false;
  return course.certificate_enabled !== false && course.certificate_enabled !== 0;
}

/** Global running number → display serial with prefix (e.g. 5000 → "SC-5000"). */
function formatCertificateSerial(seq) {
  const n = Number(seq);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${SERIAL_PREFIX}${String(n).padStart(4, '0')}`;
}

/**
 * Read-only: existing global certificate serial for a learner+course, or null if none assigned yet.
 * Used by progress so polling never mints a serial.
 */
async function getExistingCertificateSeq(userId, courseId) {
  const rows = await sequelize.query(
    `SELECT serial FROM course_certificates WHERE user_id = :uid AND course_id = :cid LIMIT 1`,
    { replacements: { uid: userId, cid: courseId }, type: QueryTypes.SELECT }
  );
  return rows[0]?.serial != null ? Number(rows[0].serial) : null;
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
 * Return the learner's global certificate serial, assigning the next one on first call. Stable per
 * (user_id, course_id): re-calls return the same serial and never advance the counter. Different
 * courses share ONE global sequence — numbering never restarts. Concurrency-safe: serials come from
 * the row-locked certificate_counter, and the (user_id, course_id) unique key prevents duplicate
 * rows for the same learner (handled via re-read on the duplicate-key race).
 */
async function getOrAssignCertificateNumber(userId, courseId) {
  const existing = await getExistingCertificateSeq(userId, courseId);
  if (existing != null) return existing;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const serial = await sequelize.transaction(async (t) => {
        // Guard against a concurrent first-open for the SAME learner having already inserted.
        const already = await sequelize.query(
          `SELECT serial FROM course_certificates WHERE user_id = :uid AND course_id = :cid LIMIT 1`,
          { replacements: { uid: userId, cid: courseId }, type: QueryTypes.SELECT, transaction: t }
        );
        if (already[0]?.serial != null) return Number(already[0].serial);

        const next = await allocateNextSerial(t);
        await sequelize.query(
          `INSERT INTO course_certificates (user_id, course_id, serial, issued_at, created_at, updated_at)
           VALUES (:uid, :cid, :serial, NOW(), NOW(), NOW())`,
          { replacements: { uid: userId, cid: courseId, serial: next }, type: QueryTypes.INSERT, transaction: t }
        );
        return next;
      });
      return serial;
    } catch (err) {
      const isDup =
        err?.original?.code === 'ER_DUP_ENTRY' ||
        err?.parent?.code === 'ER_DUP_ENTRY' ||
        err?.name === 'SequelizeUniqueConstraintError';
      if (!isDup) throw err;
      // Another request assigned this learner's row first — re-read and use it.
      const now = await getExistingCertificateSeq(userId, courseId);
      if (now != null) return now;
    }
  }
  logger.warn('[certificate] could not assign certificate serial after retries', { userId, courseId });
  // Last resort: return whatever exists (may be null); caller renders "—".
  return getExistingCertificateSeq(userId, courseId);
}

async function getLearnerDisplayName(userId) {
  const rows = await sequelize.query('SELECT name FROM users WHERE id = :id LIMIT 1', {
    replacements: { id: userId },
    type: QueryTypes.SELECT,
  });
  return rows[0]?.name?.trim() || 'Learner';
}

/**
 * Latest completion timestamp for this learner + course (all completed sessions).
 */
async function getCompletionMoment(userId, courseId) {
  const rows = await sequelize.query(
    `SELECT MAX(ucp.completed_at) AS mx, MAX(ucp.updated_at) AS ux
     FROM user_course_progress ucp
     WHERE ucp.user_id = :uid AND ucp.course_id = :cid AND ucp.status = 'completed'`,
    {
      replacements: { uid: userId, cid: courseId },
      type: QueryTypes.SELECT,
    }
  );
  const r = rows[0];
  const d = r?.mx || r?.ux || null;
  return d ? new Date(d) : null;
}

/**
 * One API payload for frontend certificate UX: course completed + access checked via progress aggregate.
 */
async function getCertificateData(userId, courseId, authHeader) {
  const progressService = require('./progress.service');
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return null;

  const progress = await progressService.getCourseProgress(String(cid), userId, authHeader);
  if (progress.totalSessions === 0 || progress.status !== 'completed') {
    return null;
  }

  const allowed = await checkCourseAccess(authHeader, cid);
  if (!allowed) return null;

  const course = await coursesService.getByIdInternal(cid);
  if (!courseProvidesCertificate(course)) return null;

  const courseTitle = course?.title?.trim() || 'Course';

  let completionDateMs = await getCompletionMoment(userId, cid);
  if (!completionDateMs) {
    completionDateMs = new Date();
  }

  const studentName = await getLearnerDisplayName(userId);

  const completionDate = completionDateMs.toISOString().slice(0, 10);

  const seq = await getOrAssignCertificateNumber(userId, cid);

  return {
    courseTitle,
    studentName,
    completionDate,
    certificateNumber: formatCertificateSerial(seq),
  };
}

/**
 * Internal variant used for server-side PDF generation (email attachment).
 * Skips bearer-based access check since it's called over internal auth.
 */
async function getCertificateDataInternal(userId, courseId) {
  const progressService = require('./progress.service');
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return null;

  // progress.service.getCourseProgress expects an authHeader, but for internal usage
  // we only need its aggregate completion status; pass null.
  const progress = await progressService.getCourseProgress(String(cid), userId, null);
  if (progress.totalSessions === 0 || progress.status !== 'completed') {
    return null;
  }

  const course = await coursesService.getByIdInternal(cid);
  if (!courseProvidesCertificate(course)) return null;

  const courseTitle = course?.title?.trim() || 'Course';

  let completionDateMs = await getCompletionMoment(userId, cid);
  if (!completionDateMs) completionDateMs = new Date();

  const studentName = await getLearnerDisplayName(userId);
  const completionDate = completionDateMs.toISOString().slice(0, 10);

  const seq = await getOrAssignCertificateNumber(userId, cid);

  return {
    courseTitle,
    studentName,
    completionDate,
    certificateNumber: formatCertificateSerial(seq),
  };
}

module.exports = {
  getCertificateData,
  getCertificateDataInternal,
  getOrAssignCertificateNumber,
  getExistingCertificateSeq,
  formatCertificateSerial,
  courseProvidesCertificate,
};
