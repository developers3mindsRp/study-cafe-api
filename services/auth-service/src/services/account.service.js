const axios = require('axios');
const { User, UserCourse, Role } = require('../models');
const config = require('../config');
const { AppError, logger } = require('../../../../shared');

function mapUserToProfile(userRow) {
  const u = userRow.get ? userRow.get({ plain: true }) : userRow;
  const roleName = u.Role?.name || u.role || 'user';
  return {
    id: String(u.id),
    email: u.email,
    name: u.name || '',
    avatar: u.profile_pic_url || undefined,
    role: roleName,
    permissions: u.permission_overrides || [],
    phone: u.phone || undefined,
    profession: u.profession || undefined,
    company: u.company || undefined,
    designation: u.designation || undefined,
    city: u.city || undefined,
    state: u.state || undefined,
    country: u.country || undefined,
    bio: u.bio != null && String(u.bio).trim() !== '' ? String(u.bio) : undefined,
    gst: u.gst || undefined,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

async function getProfile(userId) {
  const user = await User.findByPk(userId, {
    include: [{ model: Role, as: 'Role', attributes: ['id', 'name'] }],
    attributes: { exclude: ['password_hash'] },
  });
  if (!user) throw new AppError('User not found', 404);
  return mapUserToProfile(user);
}

async function updateProfile(userId, body) {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('User not found', 404);

  const allowed = [
    'name',
    'email',
    'phone',
    'profession',
    'company',
    'designation',
    'city',
    'state',
    'country',
    'profile_pic_url',
    'bio',
    'gst',
  ];
  const patch = {};
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (body.avatar !== undefined) patch.profile_pic_url = body.avatar;
  if (patch.bio !== undefined) {
    patch.bio =
      patch.bio == null || String(patch.bio).trim() === '' ? null : String(patch.bio);
  }

  await user.update(patch);
  return getProfile(userId);
}

async function updateAvatarUrl(userId, publicUrl) {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  await user.update({ profile_pic_url: publicUrl });
  return publicUrl;
}

async function deleteAccount(userId) {
  const user = await User.findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  await user.update({ is_active: false, status: 'deleted' });
}

async function fetchProgressSummary(userId, courseIds) {
  if (!courseIds.length) return {};
  try {
    const { data } = await axios.post(
      `${config.courseServiceUrl}/internal/progress/summary`,
      { userId, courseIds },
      {
        timeout: 12000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      }
    );
    const payload = data.data !== undefined ? data.data : data;
    return payload && typeof payload === 'object' ? payload : {};
  } catch (err) {
    logger.warn('[account] fetchProgressSummary failed (non-blocking)', {
      userId,
      courseIds: courseIds.slice(0, 10),
      error: err.message,
    });
    return {};
  }
}

async function dashboardStats(userId) {
  const rows = await UserCourse.findAll({
    where: { user_id: userId },
    attributes: ['course_id'],
  });
  const courseIds = rows.map((r) => Number(r.course_id)).filter((n) => n > 0);
  const totalCourses = courseIds.length;
  const summary = await fetchProgressSummary(userId, courseIds);
  let completedCourses = 0;
  let sumProgress = 0;
  for (const cid of courseIds) {
    const s = summary[cid] || summary[String(cid)];
    if (!s) continue;
    sumProgress += Number(s.progress) || 0;
    if (s.status === 'completed') completedCourses += 1;
  }
  const averageProgress = totalCourses > 0 ? Math.round(sumProgress / totalCourses) : 0;
  const inProgressCourses = Math.max(0, totalCourses - completedCourses);
  return {
    totalCourses,
    completedCourses,
    inProgressCourses,
    totalLearningHours: 0,
    averageProgress,
  };
}

async function fetchCourseMeta(courseId) {
  try {
    const base = String(config.courseServiceUrl || "").replace(/\/$/, "");
    if (!base || !config.internalApiKey) return null;
    const { data } = await axios.get(`${base}/internal/courses/${encodeURIComponent(courseId)}`, {
      timeout: 8000,
      headers: { "X-Internal-API-Key": config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    const payload = data.data !== undefined ? data.data : data;
    return payload;
  } catch (err) {
    logger.warn('[account] fetchCourseMeta failed (non-blocking)', {
      courseId,
      error: err.message,
    });
    return null;
  }
}

function courseMatchesSearch(term, { title, slug, category }) {
  const needle = String(term).trim().toLowerCase();
  if (!needle) return true;
  const fields = [title, slug, category].filter((v) => v != null && String(v).trim());
  return fields.some((v) => String(v).toLowerCase().includes(needle));
}

/**
 * My enrolled courses (from user_courses) with course title/thumbnail from course-service.
 * Optional `search` filters by course title, slug, or category (case-insensitive).
 */
async function myCourses(userId, { search } = {}) {
  const allRows = await UserCourse.findAll({ where: { user_id: userId } });
  const now = new Date();
  // Exclude rows where expires_at is set and already past — access has ended
  const rows = allRows.filter((row) => {
    const exp = row.get({ plain: true }).expires_at;
    return !exp || new Date(exp) > now;
  });
  const courseIds = rows.map((row) => Number(row.get({ plain: true }).course_id)).filter((n) => n > 0);
  const summary = await fetchProgressSummary(userId, courseIds);
  const out = [];
  for (const row of rows) {
    const r = row.get({ plain: true });
    const meta = await fetchCourseMeta(r.course_id);
    const title = meta?.title || `Course #${r.course_id}`;
    const thumb = meta?.thumbnail_url ?? meta?.thumbnail ?? null;
    const slug = meta?.slug ?? null;
    const category = Array.isArray(meta?.categories)
      ? meta.categories.map((c) => c?.name || c?.slug).filter(Boolean).join(' ')
      : (meta?.category || '');
    if (!courseMatchesSearch(search, { title, slug, category })) continue;
    const sum = summary[r.course_id] || summary[String(r.course_id)] || {};
    const progress = Number(sum.progress) || 0;
    const totalLessons = Number(sum.totalLessons) || 0;
    const completedCount = Number(sum.completedLessons) || 0;
    const expiresAt = r.expires_at ? new Date(r.expires_at).toISOString() : null;
    out.push({
      id: `${r.user_id}-${r.course_id}`,
      userId: String(r.user_id),
      courseId: String(r.course_id),
      isAdminGranted: r.order_id == null,
      course: {
        id: String(r.course_id),
        title,
        slug,
        thumbnail: thumb || '',
        thumbnail_url: thumb,
        price: meta?.price ?? 0,
        category,
        totalLessons,
      },
      purchaseDate: new Date().toISOString(),
      price: 0,
      status: 'completed',
      accessExpiresAt: expiresAt,
      accessStatus: 'active',
      progress,
      completedLessons: Array.from({ length: completedCount }, (_, i) => String(i)),
      lastAccessedAt: undefined,
    });
  }
  return out;
}

async function getSubscription(userId) {
  const { UserMembership } = require('../models');
  const now = new Date();
  const membership = await UserMembership.findOne({
    where: { user_id: userId },
    order: [['expires_at', 'DESC']],
  });
  if (!membership) {
    return { hasActiveMembership: false, membershipType: null, startsAt: null, expiresAt: null };
  }
  const m = membership.get({ plain: true });
  const isActive = new Date(m.expires_at) > now;
  const slug = m.membership_type || null;
  let membershipType = slug;
  if (isActive && slug) {
    const plan = await fetchPlanBySlug(slug);
    if (plan?.name) membershipType = plan.name;
  }
  return {
    hasActiveMembership: isActive,
    membershipType,
    membershipSlug: slug,
    startsAt: m.starts_at || null,
    expiresAt: m.expires_at || null,
  };
}

/**
 * Fetch plan details (course_ids + course_cat_ids) from platform-service by slug.
 * Returns null if the plan is not found or the request fails.
 */
async function fetchPlanBySlug(slug) {
  try {
    // Platform-service exposes an internal endpoint: GET /internal/platform/plans?slug=...
    // We must search the list since there's no /internal/platform/plans/slug/:slug
    const { data } = await axios.get(`${config.platformServiceUrl}/internal/platform/plans`, {
      timeout: 8000,
      headers: { 'x-internal-api-key': config.internalApiKey },
      validateStatus: (s) => s === 200,
    });
    const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
    const plan = list.find((p) => p.slug === slug);
    if (!plan) return null;
    // Fetch full plan with course_ids / course_cat_ids
    const { data: detail } = await axios.get(
      `${config.platformServiceUrl}/internal/platform/plans/${plan.id}`,
      {
        timeout: 8000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      },
    );
    return detail?.data ?? detail ?? null;
  } catch (err) {
    logger.warn('[account] fetchPlanBySlug failed (non-blocking)', {
      slug,
      error: err.message,
    });
    return null;
  }
}

/**
 * Fetch courses by IDs + category IDs from course-service.
 */
async function fetchCoursesByIdsOrCatIds(ids, cat_ids) {
  if (ids.length === 0 && cat_ids.length === 0) return [];
  try {
    const { data } = await axios.post(
      `${config.courseServiceUrl}/internal/courses/by-ids`,
      { ids, cat_ids },
      {
        timeout: 10000,
        headers: { 'x-internal-api-key': config.internalApiKey },
        validateStatus: (s) => s === 200,
      },
    );
    return Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : []);
  } catch (err) {
    logger.warn('[account] fetchCoursesByIdsOrCatIds failed (non-blocking)', {
      ids,
      cat_ids,
      error: err.message,
    });
    return [];
  }
}

/**
 * Returns all courses available to the user via their active memberships.
 * Groups courses by plan: [{ planName, planSlug, courses: [...] }, ...]
 * Courses are deduplicated across plans at the plan level (each plan lists its own set).
 */
async function getMembershipCourses(userId) {
  const { UserMembership } = require('../models');
  const { Op } = require('sequelize');
  const now = new Date();

  // Resolve both internal id and wp_user_id so migrated memberships are found
  const userRow = await User.findByPk(userId, { attributes: ['id', 'wp_user_id'] });
  const lookupIds = [String(userId)];
  if (userRow?.wp_user_id != null) lookupIds.push(String(userRow.wp_user_id));

  // Get ALL active memberships for this user (multiple plans possible)
  const memberships = await UserMembership.findAll({
    where: { user_id: { [Op.in]: lookupIds } },
    order: [['expires_at', 'DESC']],
  });

  const activeMemberships = memberships
    .map((m) => m.get({ plain: true }))
    .filter((m) => new Date(m.expires_at) > now);

  if (activeMemberships.length === 0) return [];

  const results = [];

  for (const membership of activeMemberships) {
    const slug = membership.membership_type;
    if (!slug) continue;

    const plan = await fetchPlanBySlug(slug);
    const course_ids = Array.isArray(plan?.course_ids) ? plan.course_ids : [];
    const course_cat_ids = Array.isArray(plan?.course_cat_ids) ? plan.course_cat_ids : [];

    const courses = await fetchCoursesByIdsOrCatIds(course_ids, course_cat_ids);

    results.push({
      membershipId: membership.id,
      planSlug: slug,
      planName: plan?.name || slug,
      startsAt: membership.starts_at,
      expiresAt: membership.expires_at,
      courses,
    });
  }

  return results;
}

module.exports = {
  getProfile,
  updateProfile,
  updateAvatarUrl,
  deleteAccount,
  dashboardStats,
  myCourses,
  mapUserToProfile,
  getSubscription,
  getMembershipCourses,
};
