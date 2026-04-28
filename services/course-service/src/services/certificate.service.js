const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const coursesService = require('./courses.service');
const { checkCourseAccess } = require('./accessClient');

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
  const courseTitle = course?.title?.trim() || 'Course';

  let completionDateMs = await getCompletionMoment(userId, cid);
  if (!completionDateMs) {
    completionDateMs = new Date();
  }

  const studentName = await getLearnerDisplayName(userId);

  const completionDate = completionDateMs.toISOString().slice(0, 10);

  return {
    courseTitle,
    studentName,
    completionDate,
  };
}

module.exports = {
  getCertificateData,
};
