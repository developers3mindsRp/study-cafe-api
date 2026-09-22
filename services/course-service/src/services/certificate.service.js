const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const coursesService = require('./courses.service');
const { checkCourseAccess } = require('./accessClient');
const { assignSerial, formatCertificateSerial } = require('./certificateSerial.service');

function courseProvidesCertificate(course) {
  if (!course) return false;
  return course.certificate_enabled !== false && course.certificate_enabled !== 0;
}

/**
 * Read-only: existing global certificate serial for a learner+course, or null if none assigned yet.
 * Used by progress so polling never mints a serial.
 */
async function getExistingCertificateSeq(userId, courseId, t = null) {
  const rows = await sequelize.query(
    `SELECT serial FROM course_certificates WHERE user_id = :uid AND course_id = :cid LIMIT 1`,
    { replacements: { uid: userId, cid: courseId }, type: QueryTypes.SELECT, transaction: t || undefined }
  );
  return rows[0]?.serial != null ? Number(rows[0].serial) : null;
}

/**
 * Return the learner's global certificate serial, assigning the next one on first call. Stable per
 * (user_id, course_id): re-calls return the same serial and never advance the counter. Every course
 * — and every link-issued public certificate — shares ONE global sequence, so numbering never
 * restarts and the two ledgers can never collide. Concurrency and retry semantics live in
 * certificateSerial.service.js.
 */
async function getOrAssignCertificateNumber(userId, courseId) {
  return assignSerial({
    context: { userId, courseId },
    readExisting: (t) => getExistingCertificateSeq(userId, courseId, t),
    insertWithSerial: (serial, t) =>
      sequelize.query(
        `INSERT INTO course_certificates (user_id, course_id, serial, issued_at, created_at, updated_at)
         VALUES (:uid, :cid, :serial, NOW(), NOW(), NOW())`,
        { replacements: { uid: userId, cid: courseId, serial }, type: QueryTypes.INSERT, transaction: t }
      ),
  });
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
