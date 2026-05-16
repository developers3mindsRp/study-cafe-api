const authClient = require('../clients/authClient');
const courseClient = require('../clients/courseClient');
const platformClient = require('../clients/platformClient');
const adminLogsService = require('./adminLogs.service');
const { logger } = require('../../../../shared');

const MAX_ROWS = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_STATUS = new Set(['active', 'inactive']);
const VALID_ROLES = new Set(['student', 'instructor', 'admin']);

const PROFILE_FIELDS = [
  'name', 'first_name', 'last_name', 'phone', 'designation', 'profession', 'company',
  'city', 'state', 'country', 'linkedin', 'facebook', 'twitter', 'instagram', 'youtube', 'bio',
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function loadPlanSlugMap() {
  const { data } = await platformClient.get('/internal/platform/plans', { params: { limit: 200 } });
  const list = Array.isArray(data) ? data : data?.data ?? [];
  const map = new Map();
  for (const p of list) {
    if (p?.slug) map.set(String(p.slug).toLowerCase(), p);
  }
  return map;
}

function normalizeRow(row) {
  const normalized = {
    rowNumber: row.rowNumber != null ? Number(row.rowNumber) : null,
    email: normalizeEmail(row.email),
    password: row.password != null ? String(row.password).trim() : '',
    membership: row.membership != null ? String(row.membership).trim().toLowerCase() : '',
    status: row.status != null ? String(row.status).trim().toLowerCase() : '',
    role: row.role != null ? String(row.role).trim().toLowerCase() : '',
  };

  for (const field of PROFILE_FIELDS) {
    if (row[field] != null && String(row[field]).trim() !== '') {
      normalized[field] = String(row[field]).trim();
    }
  }

  return normalized;
}

function validateRow(row, { planSlugMap, startsAt, expiresAt, seenEmails }) {
  const fieldErrors = [];
  const email = row.email;
  const rowNumber = row.rowNumber;

  if (!email) {
    fieldErrors.push({ field: 'email', message: 'Email is required' });
  } else if (!EMAIL_RE.test(email)) {
    fieldErrors.push({ field: 'email', message: 'Invalid email format' });
  } else if (seenEmails.has(email)) {
    fieldErrors.push({
      field: 'email',
      message: `Duplicate email in CSV (first on row ${seenEmails.get(email)})`,
    });
  } else {
    seenEmails.set(email, rowNumber);
  }

  if (row.password && row.password.length < 6) {
    fieldErrors.push({ field: 'password', message: 'Password must be at least 6 characters' });
  }

  if (row.status && !VALID_STATUS.has(row.status)) {
    fieldErrors.push({ field: 'status', message: 'Status must be "active" or "inactive"' });
  }

  if (row.role && !VALID_ROLES.has(row.role)) {
    fieldErrors.push({ field: 'role', message: 'Role must be "student", "instructor", or "admin"' });
  }

  const membershipSlug = (row.membership || '').toLowerCase();
  if (membershipSlug) {
    const plan = planSlugMap.get(membershipSlug);
    if (!plan) {
      fieldErrors.push({
        field: 'membership',
        message: `Unknown plan slug "${membershipSlug}" — must match premium_plans.slug`,
      });
    } else if (plan.is_active === false || plan.is_active === 0) {
      fieldErrors.push({
        field: 'membership',
        message: `Plan "${membershipSlug}" exists but is inactive`,
      });
    }
    if (!startsAt || !expiresAt) {
      fieldErrors.push({
        field: 'membership',
        message: 'Membership start and expiry dates are required when assigning a plan',
      });
    } else if (new Date(expiresAt) <= new Date(startsAt)) {
      fieldErrors.push({
        field: 'membership',
        message: 'Membership expiry must be after start date',
      });
    }
  }

  return { fieldErrors, membershipSlug };
}

async function fetchPlanLinkedCourses(planId) {
  const { data } = await platformClient.get(`/internal/platform/plans/${planId}/linked-courses`);
  return data || { course_ids: [], course_cat_ids: [] };
}

async function resolvePlanCourseIds(planId) {
  const { course_ids = [], course_cat_ids = [] } = await fetchPlanLinkedCourses(planId);
  const courseSet = new Set(course_ids.map(Number).filter((n) => Number.isFinite(n) && n > 0));

  if (course_cat_ids.length > 0) {
    try {
      const { data: resolved } = await courseClient.post('/internal/courses/by-ids', {
        cat_ids: course_cat_ids,
      });
      if (Array.isArray(resolved)) {
        for (const c of resolved) {
          const id = c?.id != null ? Number(c.id) : NaN;
          if (Number.isFinite(id) && id > 0) courseSet.add(id);
        }
      }
    } catch (err) {
      logger.warn(`[userImport] failed to resolve plan categories for plan ${planId}: ${err.message}`);
    }
  }

  return [...courseSet];
}

const planCourseCache = new Map();

async function getPlanCourseIds(planId) {
  const key = Number(planId);
  if (planCourseCache.has(key)) return planCourseCache.get(key);
  const ids = await resolvePlanCourseIds(key);
  planCourseCache.set(key, ids);
  return ids;
}

async function fetchUserEnrolledCourseIds(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return new Set();
  try {
    const { data } = await courseClient.get(`/internal/users/${uid}/enrollments`);
    const rows = Array.isArray(data) ? data : [];
    const set = new Set();
    for (const row of rows) {
      const cid = row?.course_id != null ? Number(row.course_id) : NaN;
      if (Number.isFinite(cid) && cid > 0) set.add(cid);
    }
    return set;
  } catch (err) {
    logger.warn(`[userImport] fetchUserEnrolledCourseIds failed for user ${uid}: ${err.message}`);
    return new Set();
  }
}

async function fetchPurchaseBatchId(courseId) {
  try {
    const { data } = await courseClient.get(`/internal/courses/${courseId}/select-purchase-batch`);
    return data?.id ? Number(data.id) : null;
  } catch (err) {
    logger.warn(`[userImport] select-purchase-batch failed for course ${courseId}: ${err.message}`);
    return null;
  }
}

async function enrollUserInCourse(userId, courseId, enrolledCourseIds) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid) || cid <= 0) return { status: 'skipped' };
  if (enrolledCourseIds.has(cid)) return { status: 'already_enrolled' };

  const batchId = await fetchPurchaseBatchId(cid);
  await authClient.post('/access/grant-course', {
    userId,
    courseId: String(cid),
    orderId: null,
  });
  await courseClient.post(`/internal/courses/${cid}/auto-enroll`, {
    user_id: userId,
    batch_id: batchId,
  });
  enrolledCourseIds.add(cid);
  return { status: 'enrolled' };
}

async function grantMembershipWithCourses({
  userId,
  membershipSlug,
  plan,
  startsAt,
  expiresAt,
  enrolledCourseIds,
}) {
  await authClient.post('/access/grant-membership', {
    userId,
    membershipType: membershipSlug,
    startsAt,
    expiresAt,
    orderId: null,
  });

  const courseIds = await getPlanCourseIds(plan.id);
  let coursesEnrolled = 0;
  let coursesSkipped = 0;
  const courseErrors = [];

  for (const cid of courseIds) {
    try {
      const result = await enrollUserInCourse(userId, cid, enrolledCourseIds);
      if (result.status === 'enrolled') coursesEnrolled += 1;
      else if (result.status === 'already_enrolled') coursesSkipped += 1;
    } catch (err) {
      courseErrors.push({
        courseId: cid,
        message: err?.response?.data?.error || err.message,
      });
    }
  }

  return { coursesEnrolled, coursesSkipped, courseErrors };
}

function buildProfilePayload(row) {
  const payload = {};
  for (const field of PROFILE_FIELDS) {
    if (row[field]) payload[field] = row[field];
  }
  if (!payload.name && (row.first_name || row.last_name)) {
    payload.name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  }
  return payload;
}

function buildStatusPayload(row) {
  if (row.status === 'inactive') return { status: 'inactive', is_active: false };
  if (row.status === 'active') return { status: 'active', is_active: true };
  return {};
}

/**
 * Import users from parsed CSV rows. Validates each row independently;
 * invalid rows are reported without stopping valid rows from importing.
 */
async function importUsers({ rows, startsAt, expiresAt, adminId, reqIp }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { results: [], imported: 0, failed: 0, skipped: 0 };
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(`Maximum ${MAX_ROWS} rows per import`);
  }

  planCourseCache.clear();
  const planSlugMap = await loadPlanSlugMap();
  const seenEmails = new Map();

  const normalizedRows = rows.map((row) => normalizeRow(row));
  const results = [];

  for (const row of normalizedRows) {
    const { fieldErrors, membershipSlug } = validateRow(row, {
      planSlugMap,
      startsAt,
      expiresAt,
      seenEmails,
    });

    if (fieldErrors.length > 0) {
      results.push({
        rowNumber: row.rowNumber,
        email: row.email || '',
        status: 'error',
        fieldErrors,
        message: fieldErrors.map((e) => `${e.field}: ${e.message}`).join('; '),
      });
      continue;
    }

    const email = row.email;
    let user = null;
    let userCreated = false;
    let profileUpdated = false;

    try {
      const { data: existingUsers } = await authClient.post('/internal/users/by-emails', {
        emails: [email],
      });
      const found = Array.isArray(existingUsers) ? existingUsers[0] : null;
      if (found) user = found;

      const profilePayload = buildProfilePayload(row);
      const statusPayload = buildStatusPayload(row);

      if (!user) {
        const displayName =
          profilePayload.name ||
          email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const createPayload = {
          email,
          name: displayName,
          role: row.role || 'student',
          ...profilePayload,
          ...statusPayload,
          ...(row.password ? { password: row.password } : {}),
          ...(membershipSlug ? { membership: membershipSlug } : {}),
        };
        const { data: created } = await authClient.post('/users', createPayload);
        user = { id: created.id, email: created.email, name: created.name };
        userCreated = true;
      } else {
        const patch = { ...profilePayload, ...statusPayload };
        if (row.password) patch.password = row.password;
        if (Object.keys(patch).length > 0) {
          await authClient.put(`/users/${user.id}`, patch);
          profileUpdated = true;
        }
      }
    } catch (err) {
      const msg = err?.response?.data?.error || err?.response?.data?.message || err.message;
      results.push({
        rowNumber: row.rowNumber,
        email,
        status: 'error',
        fieldErrors: [{ field: 'row', message: msg }],
        message: msg,
      });
      continue;
    }

    const userId = Number(user.id);
    let coursesEnrolled = 0;
    let coursesSkipped = 0;
    let membershipGranted = false;
    const plan = membershipSlug ? planSlugMap.get(membershipSlug) : null;

    if (membershipSlug && plan) {
      try {
        const enrolledCourseIds = await fetchUserEnrolledCourseIds(userId);
        const grantResult = await grantMembershipWithCourses({
          userId,
          membershipSlug,
          plan,
          startsAt,
          expiresAt,
          enrolledCourseIds,
        });
        coursesEnrolled = grantResult.coursesEnrolled;
        coursesSkipped = grantResult.coursesSkipped;
        membershipGranted = true;

        await adminLogsService.logAction(
          adminId,
          'IMPORT_USER_MEMBERSHIP',
          'user_membership',
          String(userId),
          { email, membershipSlug, startsAt, expiresAt, coursesEnrolled },
          reqIp,
        );

        if (grantResult.courseErrors.length > 0) {
          results.push({
            rowNumber: row.rowNumber,
            email,
            status: userCreated ? 'created' : 'updated',
            userCreated,
            membershipGranted,
            coursesEnrolled,
            coursesSkipped,
            message: `Imported with warnings: ${grantResult.courseErrors.length} course(s) failed to enroll`,
            fieldErrors: grantResult.courseErrors.map((e) => ({
              field: `course_${e.courseId}`,
              message: e.message,
            })),
          });
          continue;
        }
      } catch (err) {
        results.push({
          rowNumber: row.rowNumber,
          email,
          status: 'error',
          userCreated,
          fieldErrors: [{ field: 'membership', message: err?.response?.data?.error || err.message }],
          message: err?.response?.data?.error || err.message,
        });
        continue;
      }
    }

    if (userCreated) {
      await adminLogsService.logAction(
        adminId,
        'IMPORT_USER',
        'user',
        String(userId),
        { email },
        reqIp,
      );
    }

    const finalStatus = userCreated
      ? 'created'
      : membershipGranted || profileUpdated
        ? 'updated'
        : 'skipped';

    results.push({
      rowNumber: row.rowNumber,
      email,
      status: finalStatus,
      userCreated,
      membershipGranted,
      coursesEnrolled,
      coursesSkipped,
    });
  }

  const imported = results.filter((r) => r.status === 'created' || r.status === 'updated').length;
  const failed = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  return { results, imported, failed, skipped };
}

module.exports = { importUsers, MAX_ROWS };
