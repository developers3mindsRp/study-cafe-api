const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');
const { UserCourseProgress, Session, Recording, Batch, sequelize } = require('../models');
const coursesService = require('./courses.service');
const { checkCourseAccess } = require('./accessClient');
const certificateService = require('./certificate.service');

async function ensureAccessAndBatch(courseId, userId, authHeader) {
  const allowed = await checkCourseAccess(authHeader, courseId);
  if (!allowed) {
    const err = new Error('Access denied');
    err.statusCode = 403;
    throw err;
  }
  await coursesService.autoEnrollInBatch(Number(courseId), Number(userId), null);
}

async function listSessionRowsForUserCourse(courseId, userId) {
  const batch = await coursesService.getUserBatchForCourse(Number(courseId), Number(userId));
  if (!batch) return { batch: null, sessions: [] };

  const sessions = await Session.findAll({
    where: { batch_id: batch.id },
    order: [
      ['day_number', 'ASC'],
      ['section_index', 'ASC'],
    ],
    include: [
      {
        model: Recording,
        as: 'Recordings',
        required: false,
      },
    ],
  });

  const rows = [];
  for (const s of sessions) {
    const plain = s.get({ plain: true });
    // Enrolled learners need playback URLs. Visibility is for public/marketing listings, not gating the player.
    const recs = (plain.Recordings || []).filter((r) => r && String(r.url || '').trim() !== '');
    rows.push({
      session: plain,
      recordings: recs,
    });
  }
  return { batch, sessions: rows };
}

async function getCourseProgress(courseId, userId, authHeader) {
  await ensureAccessAndBatch(courseId, userId, authHeader);
  const { batch, sessions: sessionPayload } = await listSessionRowsForUserCourse(courseId, userId);

  if (!batch) {
    return {
      courseId: String(courseId),
      completedSessions: 0,
      totalSessions: 0,
      percent: 0,
      status: 'not_started',
      lastSessionId: null,
      sessions: [],
    };
  }

  const sessionIds = sessionPayload.map(({ session }) => session.id);
  const totalSessions = sessionIds.length;

  const progressRows = await UserCourseProgress.findAll({
    where: { user_id: userId, course_id: courseId },
  });
  const bySession = new Map(progressRows.map((r) => [r.session_id, r.get({ plain: true })]));

  let completed = 0;
  let lastTouch = null;
  let lastSessionId = null;
  for (const sid of sessionIds) {
    const p = bySession.get(sid);
    if (p?.status === 'completed') completed += 1;
    if (p) {
      const t = new Date(p.updated_at || p.created_at || 0).getTime();
      if (!lastTouch || t > lastTouch) {
        lastTouch = t;
        lastSessionId = sid;
      }
    }
  }

  const percent = totalSessions === 0 ? 0 : Math.round((completed / totalSessions) * 100);
  const status =
    completed >= totalSessions && totalSessions > 0 ? 'completed' : completed > 0 ? 'in_progress' : 'not_started';

  const sessionsOut = sessionPayload.map(({ session, recordings }) => {
    const p = bySession.get(session.id);
    const durMin = session.duration != null ? parseInt(String(session.duration), 10) : null;
    const durSec = Number.isFinite(durMin) && durMin > 0 ? durMin * 60 : null;
    return {
      sessionId: session.id,
      dayNumber: session.day_number,
      sectionIndex: session.section_index,
      sectionTitle: session.section_title ?? null,
      dayTitle: session.title ?? null,
      title: session.section_title || session.title,
      status: p?.status || 'not_started',
      watchSeconds: p?.watch_seconds ?? 0,
      durationSeconds: p?.duration_seconds ?? durSec,
      recordings: (recordings || []).map((r) => ({
        id: r.id,
        url: r.url,
        source: r.source,
        is_visible: r.is_visible,
      })),
    };
  });

  return {
    courseId: String(courseId),
    batchId: batch.id,
    completedSessions: completed,
    totalSessions,
    percent,
    status,
    lastSessionId: lastSessionId ? String(lastSessionId) : null,
    sessions: sessionsOut,
  };
}

async function heartbeatSession(sessionId, userId, body, authHeader) {
  const session = await Session.findByPk(sessionId, {
    include: [{ model: Batch, required: true, attributes: ['id', 'course_id'] }],
  });
  if (!session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }
  const batch = session.Batch;
  const courseId = batch.course_id;
  await ensureAccessAndBatch(courseId, userId, authHeader);

  const watchSeconds = Math.max(0, parseInt(String(body.watchSeconds ?? 0), 10) || 0);
  const durationSeconds =
    body.durationSeconds != null
      ? Math.max(0, parseInt(String(body.durationSeconds), 10) || 0)
      : null;

  const [row, created] = await UserCourseProgress.findOrCreate({
    where: { user_id: userId, session_id: sessionId },
    defaults: {
      user_id: userId,
      course_id: courseId,
      session_id: sessionId,
      batch_id: batch.id,
      status: 'in_progress',
      watch_seconds: watchSeconds,
      duration_seconds: durationSeconds,
    },
  });

  if (!created) {
    row.watch_seconds = Math.max(row.watch_seconds || 0, watchSeconds);
    if (durationSeconds != null) row.duration_seconds = durationSeconds;
    await row.save();
  }

  return row.get({ plain: true });
}

async function completeSession(sessionId, userId, authHeader) {
  const session = await Session.findByPk(sessionId, {
    include: [{ model: Batch, required: true, attributes: ['id', 'course_id'] }],
  });
  if (!session) {
    const err = new Error('Session not found');
    err.statusCode = 404;
    throw err;
  }
  const batch = session.Batch;
  const courseId = batch.course_id;
  await ensureAccessAndBatch(courseId, userId, authHeader);

  const [row, created] = await UserCourseProgress.findOrCreate({
    where: { user_id: userId, session_id: sessionId },
    defaults: {
      user_id: userId,
      course_id: courseId,
      session_id: sessionId,
      batch_id: batch.id,
      status: 'completed',
      watch_seconds: 0,
      completed_at: new Date(),
    },
  });

  if (!created) {
    row.status = 'completed';
    row.completed_at = new Date();
    await row.save();
  }

  const { sessions: sessionPayload } = await listSessionRowsForUserCourse(courseId, userId);
  const sessionIds = sessionPayload.map(({ session: s }) => s.id);
  const total = sessionIds.length;

  const completedRows = await UserCourseProgress.count({
    where: {
      user_id: userId,
      course_id: courseId,
      session_id: { [Op.in]: sessionIds },
      status: 'completed',
    },
  });

  let certificate = null;
  if (total > 0 && completedRows >= total) {
    const course = await coursesService.getByIdInternal(courseId);
    const title = course?.title || 'Course';
    certificate = await certificateService.issueCertificateIfEligible({
      userId,
      courseId,
      courseTitle: title,
    });
  }

  return {
    progress: row.get({ plain: true }),
    courseCompleted: total > 0 && completedRows >= total,
    certificate,
  };
}

async function getOverallProgress(userId, authHeader) {
  const rows = await sequelize.query(
    `SELECT course_id AS course_id FROM (
        SELECT DISTINCT course_id
        FROM user_course_progress
        WHERE user_id = :userId
        UNION
        SELECT DISTINCT b.course_id
        FROM batch_enrollments be
        INNER JOIN batches b ON b.id = be.batch_id
        WHERE be.user_id = :userId
     ) AS enrolled_courses`,
    { replacements: { userId }, type: QueryTypes.SELECT }
  );
  const courseIds = [...new Set(rows.map((r) => r.course_id).filter((id) => id != null))];
  const out = [];
  for (const cid of courseIds) {
    try {
      const p = await getCourseProgress(cid, userId, authHeader);
      out.push({
        courseId: p.courseId,
        percent: p.percent,
        status: p.status,
        completedSessions: p.completedSessions,
        totalSessions: p.totalSessions,
      });
    } catch {
      // skip if access lost
    }
  }
  return out;
}

/**
 * Internal: batch summary for auth-service my-courses.
 * body: { userId, courseIds: number[] }
 */
async function internalProgressSummary({ userId, courseIds }) {
  const ids = (courseIds || []).map(Number).filter((n) => n > 0);
  if (!userId || ids.length === 0) return {};

  const result = {};
  for (const courseId of ids) {
    let batch = await coursesService.getUserBatchForCourse(courseId, userId);
    if (!batch) {
      await coursesService.autoEnrollInBatch(courseId, userId, null);
      batch = await coursesService.getUserBatchForCourse(courseId, userId);
    }
    if (!batch) {
      result[courseId] = {
        progress: 0,
        completedLessons: 0,
        totalLessons: 0,
        status: 'not_started',
      };
      continue;
    }

    const sessions = await Session.findAll({
      where: { batch_id: batch.id },
      attributes: ['id'],
    });
    const sessionIds = sessions.map((s) => s.id);
    const total = sessionIds.length;

    const completed = await UserCourseProgress.count({
      where: {
        user_id: userId,
        course_id: courseId,
        session_id: { [Op.in]: sessionIds },
        status: 'completed',
      },
    });

    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
    const status =
      completed >= total && total > 0 ? 'completed' : completed > 0 ? 'in_progress' : 'not_started';

    result[courseId] = {
      progress: percent,
      completedLessons: completed,
      totalLessons: total,
      status,
    };
  }

  return result;
}

module.exports = {
  getCourseProgress,
  heartbeatSession,
  completeSession,
  getOverallProgress,
  internalProgressSummary,
};
