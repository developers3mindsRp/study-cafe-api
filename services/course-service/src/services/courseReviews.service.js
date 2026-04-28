const { QueryTypes } = require('sequelize');
const { CourseReview, sequelize, Course } = require('../models');
const { checkCourseAccess } = require('./accessClient');

/** Public display: first name + last initial (e.g. "Rishi S.") */
function maskName(fullName) {
  const n = String(fullName || '').trim();
  if (!n) return 'Learner';
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const last = parts[parts.length - 1];
  const ini = last[0] ? `${last[0].toUpperCase()}.` : '';
  return ini ? `${first} ${ini}` : first;
}

async function upsertMyReview(userId, courseId, rating, body, authHeader) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) throw Object.assign(new Error('Invalid course'), { statusCode: 400 });

  const r = Number(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) throw Object.assign(new Error('Rating must be 1–5'), { statusCode: 400 });

  const allowed = await checkCourseAccess(authHeader, cid);
  if (!allowed) throw Object.assign(new Error('You do not have access to review this course'), { statusCode: 403 });

  const course = await Course.findByPk(cid, { attributes: ['id'] });
  if (!course) throw Object.assign(new Error('Course not found'), { statusCode: 404 });

  const text =
    body != null && String(body).trim() !== ''
      ? String(body).slice(0, 8000)
      : '';

  const now = new Date();
  const existing = await CourseReview.findOne({ where: { user_id: userId, course_id: cid } });

  if (existing) {
    existing.rating = r;
    existing.body = text || null;
    existing.updated_at = now;
    await existing.save();
    return existing.get({ plain: true });
  }

  const row = await CourseReview.create({
    user_id: userId,
    course_id: cid,
    rating: r,
    body: text || null,
    created_at: now,
    updated_at: now,
  });
  return row.get({ plain: true });
}

async function getMyReview(userId, courseId) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return null;
  const row = await CourseReview.findOne({
    where: { user_id: userId, course_id: cid },
  });
  return row ? row.get({ plain: true }) : null;
}

/**
 * Public list for marketing / learning page — masked reviewer names only.
 */
async function listReviewsForCourse(courseId, { limit = 50 } = {}) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) throw Object.assign(new Error('Invalid course'), { statusCode: 400 });

  const rows = await sequelize.query(
    `
    SELECT cr.id, cr.course_id, cr.rating, cr.body,
           cr.created_at, cr.updated_at,
           COALESCE(TRIM(u.name), '') AS user_name_full
    FROM course_reviews cr
    INNER JOIN users u ON u.id = cr.user_id
    WHERE cr.course_id = :cid
    ORDER BY cr.created_at DESC
    LIMIT :limit
    `,
    { replacements: { cid, limit: Math.min(Number(limit) || 50, 100) }, type: QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    id: row.id,
    course_id: row.course_id,
    rating: row.rating,
    body: row.body,
    reviewer_display: maskName(row.user_name_full),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function totalPages(total, limit) {
  const l = Math.max(1, limit);
  return Math.max(1, Math.ceil(total / l));
}

async function listReviewsAdmin({ page = 1, limit = 20, course_id: courseFilter } = {}) {
  const lim = Math.min(Math.max(1, parseInt(String(limit), 10) || 20), 100);
  const pg = Math.max(1, parseInt(String(page), 10) || 1);
  const offset = (pg - 1) * lim;

  const cid =
    courseFilter != null && courseFilter !== ''
      ? parseInt(String(courseFilter), 10)
      : null;
  const filterByCourse = cid != null && Number.isFinite(cid);
  const whereCourse = filterByCourse ? 'WHERE cr.course_id = :cid' : '';
  const countRows = await sequelize.query(
    `SELECT COUNT(*) AS c FROM course_reviews cr ${whereCourse}`,
    {
      replacements: filterByCourse ? { cid } : {},
      type: QueryTypes.SELECT,
    }
  );
  const total = Number(countRows[0]?.c ?? 0);

  const listReplacements = filterByCourse ? { cid, lim, offset } : { lim, offset };
  const rows = await sequelize.query(
    `
    SELECT cr.id, cr.user_id, cr.course_id, cr.rating, cr.body,
           cr.created_at, cr.updated_at,
           COALESCE(TRIM(u.name), '') AS user_name,
           COALESCE(TRIM(u.email), '') AS user_email,
           COALESCE(TRIM(c.title), '') AS course_title
    FROM course_reviews cr
    INNER JOIN users u ON u.id = cr.user_id
    LEFT JOIN courses c ON c.id = cr.course_id
    ${whereCourse}
    ORDER BY cr.created_at DESC
    LIMIT :lim OFFSET :offset
    `,
    {
      replacements: listReplacements,
      type: QueryTypes.SELECT,
    }
  );

  const totalP = totalPages(total, lim);

  return {
    data: rows.map((row) => ({
      id: row.id,
      user_id: row.user_id,
      course_id: row.course_id,
      course_title: row.course_title,
      rating: row.rating,
      body: row.body,
      user_name: row.user_name || null,
      user_email: row.user_email || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    total,
    page: pg,
    limit: lim,
    totalPages: totalP,
    hasNextPage: pg < totalP,
    hasPreviousPage: pg > 1,
  };
}

async function getReviewByIdAdmin(id) {
  const rid = Number(id);
  if (!Number.isFinite(rid)) return null;

  const rows = await sequelize.query(
    `
    SELECT cr.id, cr.user_id, cr.course_id, cr.rating, cr.body,
           cr.created_at, cr.updated_at,
           COALESCE(TRIM(u.name), '') AS user_name,
           COALESCE(TRIM(u.email), '') AS user_email,
           COALESCE(TRIM(c.title), '') AS course_title
    FROM course_reviews cr
    INNER JOIN users u ON u.id = cr.user_id
    LEFT JOIN courses c ON c.id = cr.course_id
    WHERE cr.id = :rid
    LIMIT 1
    `,
    { replacements: { rid }, type: QueryTypes.SELECT }
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    course_id: row.course_id,
    course_title: row.course_title,
    rating: row.rating,
    body: row.body,
    user_name: row.user_name || null,
    user_email: row.user_email || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function adminUpdateReview(id, { rating, body }) {
  const rid = Number(id);
  if (!Number.isFinite(rid)) throw Object.assign(new Error('Invalid id'), { statusCode: 400 });

  const row = await CourseReview.findByPk(rid);
  if (!row) throw Object.assign(new Error('Review not found'), { statusCode: 404 });

  if (rating != null) {
    const r = Number(rating);
    if (!Number.isFinite(r) || r < 1 || r > 5) throw Object.assign(new Error('Rating must be 1–5'), { statusCode: 400 });
    row.rating = r;
  }
  if (body !== undefined) {
    row.body = body != null && String(body).trim() !== '' ? String(body).slice(0, 8000) : null;
  }
  row.updated_at = new Date();
  await row.save();
  return row.get({ plain: true });
}

async function adminDeleteReview(id) {
  const rid = Number(id);
  if (!Number.isFinite(rid)) throw Object.assign(new Error('Invalid id'), { statusCode: 400 });

  const n = await CourseReview.destroy({ where: { id: rid } });
  if (!n) throw Object.assign(new Error('Review not found'), { statusCode: 404 });
  return true;
}

module.exports = {
  upsertMyReview,
  getMyReview,
  listReviewsForCourse,
  listReviewsAdmin,
  getReviewByIdAdmin,
  adminUpdateReview,
  adminDeleteReview,
};
