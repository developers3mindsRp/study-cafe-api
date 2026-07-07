const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const coursesService = require('./courses.service');
const { checkCourseAccess } = require('./accessClient');
const { logger } = require('../../../../shared');

function courseProvidesCertificate(course) {
  if (!course) return false;
  return course.certificate_enabled !== false && course.certificate_enabled !== 0;
}

/** Per-course running number → display serial. At least 4 digits, grows beyond 9999. */
function formatCertificateSerial(seq) {
  const n = Number(seq);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n).padStart(4, '0');
}

/**
 * Read-only: existing per-course certificate sequence for a learner, or null if none assigned yet.
 * Used by progress so polling never mints a number.
 */
async function getExistingCertificateSeq(userId, courseId) {
  const rows = await sequelize.query(
    `SELECT cert_seq FROM course_certificates WHERE user_id = :uid AND course_id = :cid LIMIT 1`,
    { replacements: { uid: userId, cid: courseId }, type: QueryTypes.SELECT }
  );
  return rows[0]?.cert_seq != null ? Number(rows[0].cert_seq) : null;
}

/**
 * Return the learner's per-course certificate sequence, assigning the next one atomically on first
 * call. Stable per (user_id, course_id): re-calls return the same number and never advance the
 * counter. Concurrency-safe via the (course_id, cert_seq) and (user_id, course_id) unique keys with
 * a bounded retry on duplicate-key races.
 */
async function getOrAssignCertificateNumber(userId, courseId) {
  const existing = await getExistingCertificateSeq(userId, courseId);
  if (existing != null) return existing;

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const seq = await sequelize.transaction(async (t) => {
        // Next sequence for this course. The unique key (course_id, cert_seq) rejects collisions
        // from a concurrent insert, which we handle via retry below.
        const maxRows = await sequelize.query(
          `SELECT COALESCE(MAX(cert_seq), 0) AS mx FROM course_certificates WHERE course_id = :cid`,
          { replacements: { cid: courseId }, type: QueryTypes.SELECT, transaction: t }
        );
        const next = Number(maxRows[0]?.mx || 0) + 1;
        await sequelize.query(
          `INSERT INTO course_certificates (user_id, course_id, cert_seq, issued_at, created_at, updated_at)
           VALUES (:uid, :cid, :seq, NOW(), NOW(), NOW())`,
          { replacements: { uid: userId, cid: courseId, seq: next }, type: QueryTypes.INSERT, transaction: t }
        );
        return next;
      });
      return seq;
    } catch (err) {
      const isDup =
        err?.original?.code === 'ER_DUP_ENTRY' ||
        err?.parent?.code === 'ER_DUP_ENTRY' ||
        err?.name === 'SequelizeUniqueConstraintError';
      if (!isDup) throw err;
      // Either another request assigned this user's row (re-read wins) or grabbed our seq (retry).
      const now = await getExistingCertificateSeq(userId, courseId);
      if (now != null) return now;
      // else: seq collision with a different user — loop and recompute MAX+1.
    }
  }
  logger.warn('[certificate] could not assign certificate number after retries', { userId, courseId });
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
