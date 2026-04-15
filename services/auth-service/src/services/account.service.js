const axios = require('axios');
const { User, UserCourse, Role } = require('../models');
const config = require('../config');
const { AppError } = require('../../../../shared');

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

async function dashboardStats(userId) {
  const totalCourses = await UserCourse.count({ where: { user_id: userId } });
  return {
    totalCourses,
    completedCourses: 0,
    inProgressCourses: totalCourses,
    totalLearningHours: 0,
    averageProgress: totalCourses > 0 ? 0 : 0,
  };
}

async function fetchCourseMeta(courseId) {
  try {
    const { data } = await axios.get(`${config.courseServiceUrl}/courses/${courseId}`, {
      timeout: 8000,
      validateStatus: (s) => s === 200,
    });
    const payload = data.data !== undefined ? data.data : data;
    return payload;
  } catch {
    return null;
  }
}

/**
 * My enrolled courses (from user_courses) with course title/thumbnail from course-service.
 */
async function myCourses(userId) {
  const rows = await UserCourse.findAll({ where: { user_id: userId } });
  const out = [];
  for (const row of rows) {
    const r = row.get({ plain: true });
    const meta = await fetchCourseMeta(r.course_id);
    const title = meta?.title || `Course #${r.course_id}`;
    const thumb = meta?.thumbnail_url ?? meta?.thumbnail ?? null;
    out.push({
      id: `${r.user_id}-${r.course_id}`,
      userId: String(r.user_id),
      courseId: String(r.course_id),
      course: {
        id: String(r.course_id),
        title,
        thumbnail: thumb || '',
        thumbnail_url: thumb,
        price: meta?.price ?? 0,
        category: meta?.category || '',
      },
      purchaseDate: new Date().toISOString(),
      price: 0,
      status: 'completed',
      progress: 0,
      completedLessons: [],
      lastAccessedAt: undefined,
    });
  }
  return out;
}

module.exports = {
  getProfile,
  updateProfile,
  updateAvatarUrl,
  deleteAccount,
  dashboardStats,
  myCourses,
  mapUserToProfile,
};
