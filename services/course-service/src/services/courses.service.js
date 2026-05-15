const {
  Course,
  CourseAuthor,
  CourseCat,
  CourseCategory,
  Batch,
  Session,
  Recording,
  Material,
  CoursePageSetting,
  BatchEnrollment,
  Enrollment,
  UserCourse,
} = require("../models");
const { QueryTypes, Op } = require("sequelize");
const axios = require("axios");
const config = require("../config");
const { logger, AppError } = require("../../../../shared");
const { checkCourseAccess } = require("./accessClient");

const COURSE_SLUG_MAX_LEN = 200;

/** Normalize slug for storage / uniqueness checks (ASCII-ish segment). */
function normalizeCourseSlugSegment(raw) {
  if (raw == null) return "";
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Ensures `courses.slug` is globally unique. On update, pass excludeCourseId so the
 * current row does not count as a conflict. Appends -2, -3, … if needed (max length 200).
 */
async function allocateUniqueCourseSlug(rawSlug, excludeCourseId) {
  const base = normalizeCourseSlugSegment(rawSlug);
  if (!base) return null;

  let n = 0;
  for (;;) {
    const suffix = n === 0 ? "" : `-${n + 1}`;
    let candidate = base + suffix;
    if (candidate.length > COURSE_SLUG_MAX_LEN) {
      const room = COURSE_SLUG_MAX_LEN - suffix.length;
      candidate = (room > 0 ? base.slice(0, room) : "c") + suffix;
      candidate = candidate.replace(/-+$/g, "");
    }
    const where = { slug: candidate };
    if (excludeCourseId != null) {
      where.id = { [Op.ne]: excludeCourseId };
    }
    const existing = await Course.findOne({ where, attributes: ["id"], raw: true });
    if (!existing) return candidate;
    n += 1;
    if (n > 2000) {
      throw new AppError("Could not allocate a unique course slug", 500);
    }
  }
}

/** Grant auth-service user_courses row so access/check + dashboard work (admin batch enroll, auto-enroll). */
async function syncUserCourseGrant(userId, courseId) {
  const base = config.authServiceUrl?.replace(/\/$/, "") || "";
  if (!base || !config.internalApiKey) {
    logger.warn("[courses] syncUserCourseGrant skipped: missing AUTH_SERVICE_URL or INTERNAL_API_KEY");
    return;
  }
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(cid) || cid <= 0) return;
  try {
    await axios.post(
      `${base}/access/grant-course`,
      { userId: uid, courseId: cid, orderId: null },
      {
        headers: { "X-Internal-API-Key": config.internalApiKey },
        timeout: 10000,
        validateStatus: (s) => s === 200,
      },
    );
  } catch (err) {
    logger.warn(`[courses] syncUserCourseGrant failed userId=${uid} courseId=${cid}: ${err.message}`);
  }
}

/** Published course detail/sessions/materials: hidden courses only for viewers with access. */
async function allowPublicCourseDetail(hideFromPublic, courseId, authorization) {
  if (!hideFromPublic) return true;
  if (!courseId) return false;
  return checkCourseAccess(authorization, courseId);
}

function stripCurriculumVideos(course) {
  if (!course || course.curriculum == null) return course;
  let cur = course.curriculum;
  if (typeof cur === "string") {
    try {
      cur = JSON.parse(cur);
    } catch {
      return course;
    }
  }
  if (!Array.isArray(cur)) return course;
  const stripped = cur.map((day) => {
    const d = { ...day };
    delete d.video;
    if (Array.isArray(d.sections)) {
      d.sections = d.sections.map((sec) => {
        const s = { ...sec };
        delete s.videoId;
        delete s.video;
        delete s.videos;
        delete s.recordings;
        return s;
      });
    }
    return d;
  });
  return { ...course, curriculum: stripped };
}

function withCourseMetaDetail(course) {
  const title = (course?.title || "").trim();
  const fallbackDescription =
    typeof course?.brief_description === "string" && course.brief_description.trim()
      ? course.brief_description.trim()
      : typeof course?.description === "string"
        ? course.description
        : "";

  const metaTitle =
    typeof course?.meta_title === "string" && course.meta_title.trim()
      ? course.meta_title.trim()
      : title;
  const metaDescription =
    typeof course?.meta_description === "string" && course.meta_description.trim()
      ? course.meta_description.trim()
      : fallbackDescription;
  const metaKeywords =
    typeof course?.meta_keywords === "string" && course.meta_keywords.trim()
      ? course.meta_keywords.trim()
      : typeof course?.keywords === "string" && course.keywords.trim()
        ? course.keywords.trim()
        : "";

  const ogTitle =
    typeof course?.og_title === "string" && course.og_title.trim()
      ? course.og_title.trim()
      : metaTitle;
  const ogDescription =
    typeof course?.og_description === "string" && course.og_description.trim()
      ? course.og_description.trim()
      : metaDescription;
  let ogImageUrl = "";
  if (typeof course?.og_image_url === "string" && course.og_image_url.trim()) {
    ogImageUrl = course.og_image_url.trim();
  } else if (typeof course?.thumbnail_url === "string" && course.thumbnail_url.trim()) {
    ogImageUrl = course.thumbnail_url.trim();
  }

  return {
    ...course,
    meta_detail: {
      meta_title: metaTitle,
      meta_description: metaDescription,
      meta_keywords: metaKeywords,
      og_title: ogTitle,
      og_description: ogDescription,
      og_image_url: ogImageUrl,
    },
  };
}

/** One curriculum section can have multiple recordings (videos[] / recordings[] / legacy videoId). */
function collectVideoUrlsFromSection(sec) {
  const out = [];
  if (!sec || typeof sec !== "object") return out;
  if (Array.isArray(sec.videos) && sec.videos.length) {
    for (const v of sec.videos) {
      if (v != null && typeof v === "object" && !Array.isArray(v)) {
        const u = v.url ?? v.videoId ?? v.video;
        if (u != null && String(u).trim()) out.push(String(u).trim());
      } else if (v != null && String(v).trim()) {
        out.push(String(v).trim());
      }
    }
  }
  if (Array.isArray(sec.recordings) && sec.recordings.length) {
    for (const rec of sec.recordings) {
      const u = rec && (rec.url || rec.videoId || rec.video);
      if (u != null && String(u).trim()) out.push(String(u).trim());
    }
  }
  if (out.length === 0) {
    const single = sec.videoId || sec.video;
    if (single != null && String(single).trim()) out.push(String(single).trim());
  }
  return [...new Set(out)];
}

function normalizeLanguage(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] === "string") {
      const v = value[0];
      try {
        const p = JSON.parse(v);
        if (Array.isArray(p)) return p;
      } catch { }
      if (v.includes(","))
        return v
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean);
      return [v];
    }
    return value;
  }
  if (typeof value === "string") {
    try {
      const p = JSON.parse(value);
      if (Array.isArray(p)) return p;
    } catch { }
    if (value.includes(","))
      return value
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
    return [value];
  }
  return [];
}

/** Parse course.curriculum (string or array) into a day array. */
function parseCurriculumDays(curriculum) {
  if (curriculum == null) return [];
  let cur = curriculum;
  if (typeof cur === "string") {
    try {
      cur = JSON.parse(cur);
    } catch {
      return [];
    }
  }
  return Array.isArray(cur) ? cur : [];
}

/**
 * Total course duration in minutes from stored curriculum (same section rules as batch/session creation).
 * Sums each section's `duration`; legacy flat days use `minutes` on the day for a single synthetic section.
 */
function totalCurriculumDurationMinutes(curriculum) {
  const days = parseCurriculumDays(curriculum);
  let total = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (!day || typeof day !== "object") continue;
    const dayNumber = i + 1;
    const dayTitle = day.title || `Day ${dayNumber}`;
    const sections =
      Array.isArray(day.sections) && day.sections.length > 0
        ? day.sections
        : [
          {
            title: dayTitle,
            description: day.description || "",
            videoId: day.video || "",
            duration: day.minutes || "",
          },
        ];
    for (const sec of sections) {
      if (!sec || typeof sec !== "object") continue;
      const raw = sec.duration;
      if (raw == null || raw === "") continue;
      const n = parseInt(String(raw), 10);
      if (Number.isFinite(n) && n > 0) total += n;
    }
  }
  return total > 0 ? total : null;
}

function withListingDuration(plain) {
  const duration = totalCurriculumDurationMinutes(plain.curriculum);
  const out = { ...plain, duration };
  delete out.curriculum;
  return out;
}

const coursesService = {
  async getCourseAuthors(courseId) {
    const links = await CourseAuthor.findAll({
      where: { course_id: courseId },
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
      raw: true,
    });

    if (links.length === 0) return [];

    const userIds = [...new Set(links.map((l) => l.user_id).filter(Boolean))];
    if (userIds.length === 0) return [];

    const users = await Course.sequelize.query(
      `SELECT id, name, designation, profession, profile_pic_url
       FROM users
       WHERE id IN (:userIds)`,
      {
        replacements: { userIds },
        type: QueryTypes.SELECT,
      },
    );

    const userMap = new Map(users.map((u) => [Number(u.id), u]));

    return links.map((link) => {
      const user = userMap.get(Number(link.user_id)) || {};
      return {
        user_id: link.user_id,
        sort_order: link.sort_order,
        name: user.name || null,
        role: user.designation || null,
        bio: user.profession || null,
        image_url: user.profile_pic_url || null,
      };
    });
  },

  async enrichCourseWithAuthors(courseData) {
    const authors = await this.getCourseAuthors(courseData.id);
    const primaryAuthor = authors[0] || null;
    return {
      ...courseData,
      authors,
      author_user_id: primaryAuthor?.user_id ?? null,
      author_name: primaryAuthor?.name ?? null,
      author_role: primaryAuthor?.role ?? null,
      author_bio: primaryAuthor?.bio ?? null,
      author_image: primaryAuthor?.image_url ?? null,
    };
  },

  /** Admin/internal: course_cats link ids for this course. */
  async getCourseCatIdsForCourse(courseId) {
    const links = await CourseCategory.findAll({
      where: { course_id: courseId },
      attributes: ["course_cat_id"],
      raw: true,
    });
    return links.map((l) => Number(l.course_cat_id)).filter((n) => Number.isFinite(n));
  },

  async attachCourseCatIds(enrichedPlain) {
    if (!enrichedPlain?.id) return enrichedPlain;
    const course_cat_ids = await this.getCourseCatIdsForCourse(enrichedPlain.id);
    let categories = [];
    if (course_cat_ids.length > 0) {
      const { Op } = require("sequelize");
      categories = await CourseCat.findAll({
        where: { id: { [Op.in]: course_cat_ids } },
        attributes: ["id", "name", "slug"],
        order: [["name", "ASC"]],
        raw: true,
      });
    }
    return { ...enrichedPlain, course_cat_ids, categories };
  },

  async upsertPrimaryAuthorProfile(courseId, data) {
    const authorFieldsPresent =
      data.author_user_id !== undefined ||
      data.author_name !== undefined ||
      data.author_role !== undefined ||
      data.author_bio !== undefined ||
      data.author_image !== undefined;

    if (!authorFieldsPresent) return;

    const existing = await CourseAuthor.findOne({
      where: { course_id: courseId },
      order: [
        ["sort_order", "ASC"],
        ["id", "ASC"],
      ],
    });

    let userId = data.author_user_id ?? existing?.user_id ?? null;

    if (userId == null) {
      // Admin UI always sends author_* keys (often null). Only treat as an author
      // update when at least one field has real content; otherwise skip quietly.
      const authorFieldHasValue = (v) =>
        v !== undefined && v !== null && String(v).trim() !== "";
      const hasProfileValues =
        authorFieldHasValue(data.author_name) ||
        authorFieldHasValue(data.author_role) ||
        authorFieldHasValue(data.author_bio) ||
        authorFieldHasValue(data.author_image);

      if (hasProfileValues) {
        throw new AppError(
          "author_user_id is required to update author profile",
          400,
        );
      }
      return;
    }

    if (existing) {
      if (existing.user_id !== userId) {
        existing.user_id = userId;
        await existing.save();
      }
    } else {
      await CourseAuthor.create({
        course_id: courseId,
        user_id: userId,
        sort_order: 0,
      });
    }

    const updates = [];
    const replacements = { userId };

    if (data.author_name !== undefined) {
      updates.push("name = :authorName");
      replacements.authorName = data.author_name || null;
    }
    if (data.author_role !== undefined) {
      updates.push("designation = :authorRole");
      replacements.authorRole = data.author_role || null;
    }
    if (data.author_bio !== undefined) {
      updates.push("profession = :authorBio");
      replacements.authorBio = data.author_bio || null;
    }
    if (data.author_image !== undefined) {
      updates.push("profile_pic_url = :authorImage");
      replacements.authorImage = data.author_image || null;
    }

    if (updates.length > 0) {
      updates.push("updated_at = NOW()");
      await Course.sequelize.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = :userId`,
        {
          replacements,
          type: QueryTypes.UPDATE,
        },
      );
    }
  },

  async listPublished() {
    const rows = await Course.findAll({
      where: { is_published: true, hide_from_public: false },
      order: [["created_at", "DESC"]],
      attributes: [
        "id",
        "title",
        "brief_description",
        "price",
        "sale_price",
        "thumbnail_url",
        "is_published",
        "created_at",
        "language",
        "curriculum",
      ],
    });
    return rows.map((r) => {
      const d = r.get({ plain: true });
      d.language = normalizeLanguage(d.language);
      return withListingDuration(d);
    });
  },

  /** Homepage / marketing: latest published courses (must match GET /courses/featured). */
  async listFeaturedPublished(limit = 6) {
    const lim = Math.min(24, Math.max(1, parseInt(String(limit), 10) || 6));
    const rows = await Course.findAll({
      where: { is_published: true, hide_from_public: false },
      order: [["created_at", "DESC"]],
      limit: lim,
      attributes: [
        "id",
        "title",
        "slug",
        "brief_description",
        "price",
        "sale_price",
        "thumbnail_url",
        "is_published",
        "created_at",
        "language",
        "curriculum",
      ],
    });
    return rows.map((r) => {
      const d = r.get({ plain: true });
      d.language = normalizeLanguage(d.language);
      return withListingDuration(d);
    });
  },

  async listAll() {
    const rows = await Course.findAll({
      order: [
        ["is_published", "DESC"],
        ["id", "DESC"],
      ],
      attributes: [
        "id",
        "title",
        "brief_description",
        "price",
        "sale_price",
        "thumbnail_url",
        "is_published",
        "hide_from_public",
        "created_at",
        "updated_at",
        "enrolled_count",
        "language",
        "curriculum",
      ],
      include: [
        {
          model: CourseCat,
          attributes: ["id", "name", "slug"],
          through: { attributes: [] },
          required: false,
        },
      ],
    });

    return rows.map((r) => {
      const d = r.get({ plain: true });
      d.language = normalizeLanguage(d.language);
      const cats = d.CourseCats ?? [];
      delete d.CourseCats;
      d.categories = cats.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug ?? null,
      }));
      d.course_cat_ids = cats.map((c) => c.id);
      return withListingDuration(d);
    });
  },

  async listCourseCats() {
    const rows = await CourseCat.findAll({
      order: [["name", "ASC"]],
      attributes: ["id", "name", "slug", "is_featured"],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async getById(id, opts = {}) {
    const row = await Course.findOne({ where: { id, is_published: true } });
    if (!row) return null;
    const d = row.get({ plain: true });
    const coursePk = d.id;
    const visible = await allowPublicCourseDetail(d.hide_from_public, coursePk, opts.authorization);
    if (!visible) return null;
    d.language = normalizeLanguage(d.language);
    const enriched = await this.enrichCourseWithAuthors(d);
    const allowed = await checkCourseAccess(opts.authorization, coursePk);
    const batchOpts = allowed
      ? { visibleOnly: true }
      : { visibleOnly: true, stripRecordings: true };
    const batchesRaw = await this._getBatchesSessionsRecordings(coursePk, batchOpts);
    const batches = Array.isArray(batchesRaw) ? batchesRaw : [];

    const materials = await Material.findAll({
      where: { course_id: coursePk },
      order: [["id", "ASC"]],
      attributes: ["id", "title", "url", "type"],
    });

    const catLinks = await CourseCategory.findAll({
      where: { course_id: coursePk },
      attributes: ["course_cat_id"],
      raw: true,
    });
    const catIds = catLinks.map((l) => l.course_cat_id);
    let categories = [];
    if (catIds.length > 0) {
      const { Op } = require("sequelize");
      categories = await CourseCat.findAll({
        where: { id: { [Op.in]: catIds } },
        attributes: ["id", "name", "slug"],
        raw: true,
      });
    }

    const result = withCourseMetaDetail({
      ...enriched,
      batches,
      materials: materials.map((m) => m.get({ plain: true })),
      categories,
    });
    if (!allowed) return stripCurriculumVideos(result);
    return result;
  },

  async getBySlug(slug, opts = {}) {
    const row = await Course.findOne({ where: { slug, is_published: true } });
    if (!row) return null;
    const d = row.get({ plain: true });
    const visible = await allowPublicCourseDetail(d.hide_from_public, d.id, opts.authorization);
    if (!visible) return null;
    d.language = normalizeLanguage(d.language);
    const enriched = await this.enrichCourseWithAuthors(d);
    const coursePk = d.id;
    const allowed = await checkCourseAccess(opts.authorization, coursePk);
    const batchOpts = allowed
      ? { visibleOnly: true }
      : { visibleOnly: true, stripRecordings: true };
    const batchesRaw = await this._getBatchesSessionsRecordings(coursePk, batchOpts);
    const batches = Array.isArray(batchesRaw) ? batchesRaw : [];

    const materials = await Material.findAll({
      where: { course_id: coursePk },
      order: [["id", "ASC"]],
      attributes: ["id", "title", "url", "type"],
    });

    const catLinks = await CourseCategory.findAll({
      where: { course_id: coursePk },
      attributes: ["course_cat_id"],
      raw: true,
    });
    const catIds = catLinks.map((l) => l.course_cat_id);
    let categories = [];
    if (catIds.length > 0) {
      const { Op } = require("sequelize");
      categories = await CourseCat.findAll({
        where: { id: { [Op.in]: catIds } },
        attributes: ["id", "name", "slug"],
        raw: true,
      });
    }

    const result = withCourseMetaDetail({
      ...enriched,
      batches,
      materials: materials.map((m) => m.get({ plain: true })),
      categories,
    });
    if (!allowed) return stripCurriculumVideos(result);
    return result;
  },

  /**
   * Public slug sessions endpoint.
   * - Anonymous / non-purchaser: returns ALL batches with meta (so banner can show upcoming date)
   *   but recordings are stripped (only visible ones passed through).
   * - If userId is provided (purchaser): returns only the batch they are enrolled into,
   *   with visible recordings attached.
   *
   * This guarantees a learner sees ONLY recordings of their own batch cohort.
   */
  async getSessionsBySlug(slug, { userId = null, authorization = null } = {}) {
    const course = await Course.findOne({
      where: { slug, is_published: true },
      attributes: ["id", "hide_from_public"],
    });
    if (!course) return null;
    const cplain = course.get({ plain: true });
    const vis = await allowPublicCourseDetail(cplain.hide_from_public, cplain.id, authorization);
    if (!vis) return null;

    if (userId) {
      const userBatch = await this.getUserBatchForCourse(cplain.id, userId);
      if (userBatch) {
        return this._getBatchesSessionsRecordings(cplain.id, {
          visibleOnly: true,
          onlyBatchId: userBatch.id,
        });
      }

      // Lazy Auto-Enrollment for Membership Users
      // If the user lacks a batch but has access (via membership), enroll them now.
      const hasAccess = await checkCourseAccess(authorization, cplain.id);
      if (hasAccess) {
        const enrolled = await this.autoEnrollInBatch(cplain.id, userId);
        if (enrolled && enrolled.batch_id) {
          return this._getBatchesSessionsRecordings(cplain.id, {
            visibleOnly: true,
            onlyBatchId: enrolled.batch_id,
          });
        }
      }
    }

    // Not purchased (or anonymous) → return batch schedule without recordings.
    return this._getBatchesSessionsRecordings(cplain.id, {
      visibleOnly: true,
      stripRecordings: true,
    });
  },

  async getByIdInternal(id) {
    const row = await Course.findByPk(id);
    if (!row) return null;
    const d = row.get({ plain: true });
    const enriched = await this.enrichCourseWithAuthors(d);
    const withCats = await this.attachCourseCatIds(enriched);
    const batchesRaw = await this._getBatchesSessionsRecordings(d.id, { visibleOnly: false });
    const batches = Array.isArray(batchesRaw) ? batchesRaw : [];
    return { ...withCats, batches };
  },

  async getSessionsByCourseId(courseId, opts = {}) {
    const course = await Course.findOne({
      where: { id: courseId, is_published: true },
      attributes: ["id", "hide_from_public"],
    });
    if (!course) return null;
    const cplain = course.get({ plain: true });
    const vis = await allowPublicCourseDetail(cplain.hide_from_public, courseId, opts.authorization);
    if (!vis) return null;
    return this._getBatchesSessionsRecordings(courseId, { visibleOnly: true });
  },

  /** Same as getSessionsByCourseId but without is_published filter (for admin). */
  async getSessionsByCourseIdInternal(courseId) {
    const course = await Course.findByPk(courseId, { attributes: ["id"] });
    if (!course) return null;
    return this._getBatchesSessionsRecordings(courseId, { visibleOnly: false });
  },

  async _getBatchesSessionsRecordings(
    courseId,
    { visibleOnly = false, onlyBatchId = null, stripRecordings = false } = {}
  ) {
    const where = { course_id: courseId };
    if (onlyBatchId) where.id = onlyBatchId;
    const batches = await Batch.findAll({
      where,
      order: [["created_at", "ASC"]],
    });

    const result = [];
    for (const b of batches) {
      const sessions = await Session.findAll({
        where: { batch_id: b.id },
        order: [["day_number", "ASC"], ["section_index", "ASC"]],
        include: [
          {
            model: Recording,
            as: "Recordings",
            required: false,
            ...(visibleOnly ? { where: { is_visible: true } } : {}),
          },
        ],
      });
      result.push({
        id: b.id,
        name: b.name,
        start_date: b.start_date,
        end_date: b.end_date,
        meet_link: b.meet_link,
        created_at: b.created_at,
        sessions: sessions.map((s) => ({
          id: s.id,
          batch_id: s.batch_id,
          day_number: s.day_number,
          section_index: s.section_index ?? 0,
          title: s.title,
          section_title: s.section_title || null,
          duration: s.duration || null,
          scheduled_at: s.scheduled_at,
          meet_link: s.meet_link,
          recordings: stripRecordings
            ? []
            : (s.Recordings || []).map((r) => ({
              id: r.id,
              url: r.url,
              source: r.source,
              is_visible: r.is_visible,
            })),
        })),
      });
    }
    return result;
  },

  /**
   * Admin: paginated batches across all courses (or one course), with full sessions + recordings.
   */
  async listBatchesAdminPaginated({ courseId = null, page = 1, limit = 10 } = {}) {
    const safeLimit = Math.min(50, Math.max(1, parseInt(String(limit), 10) || 10));
    const safePage = Math.max(1, parseInt(String(page), 10) || 1);
    const offset = (safePage - 1) * safeLimit;

    const where = {};
    const cid = courseId != null && courseId !== "" ? Number(courseId) : NaN;
    if (Number.isFinite(cid) && cid > 0) {
      where.course_id = cid;
    }

    const { count: total, rows } = await Batch.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      limit: safeLimit,
      offset,
      include: [{ model: Course, as: "Course", attributes: ["id", "title"] }],
    });

    const data = [];
    for (const b of rows) {
      const plain = b.get({ plain: true });
      const courseTitle = plain.Course?.title ?? "";
      const full = await this._getBatchesSessionsRecordings(plain.course_id, {
        visibleOnly: false,
        onlyBatchId: plain.id,
      });
      const batchPayload = full[0] || {
        id: plain.id,
        name: plain.name,
        start_date: plain.start_date,
        end_date: plain.end_date,
        meet_link: plain.meet_link,
        created_at: plain.created_at,
        sessions: [],
      };
      data.push({
        ...batchPayload,
        course_id: plain.course_id,
        course_title: courseTitle,
      });
    }

    const totalPages = total === 0 ? 0 : Math.ceil(total / safeLimit);
    const meta = {
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
      hasNextPage: totalPages > 0 && safePage < totalPages,
      hasPreviousPage: safePage > 1,
    };
    return { data, meta };
  },

  /** Admin / internal: single batch with owning course slug (for order-service enrichment). */
  async getBatchByIdInternal(batchId) {
    const row = await Batch.findByPk(batchId, {
      include: [{ model: Course, as: "Course", attributes: ["id", "title", "slug"] }],
    });
    if (!row) return null;
    const plain = row.get({ plain: true });
    return {
      id: plain.id,
      course_id: plain.course_id,
      name: plain.name,
      start_date: plain.start_date,
      end_date: plain.end_date,
      meet_link: plain.meet_link,
      created_at: plain.created_at,
      course_slug: plain.Course?.slug ?? null,
      course_title: plain.Course?.title ?? null,
    };
  },

  async getMaterialsByCourseId(courseId, opts = {}) {
    const course = await Course.findOne({
      where: { id: courseId, is_published: true },
      attributes: ["id", "hide_from_public"],
    });
    if (!course) return null;
    const cplain = course.get({ plain: true });
    const vis = await allowPublicCourseDetail(cplain.hide_from_public, courseId, opts.authorization);
    if (!vis) return null;
    const rows = await Material.findAll({
      where: { course_id: courseId },
      order: [["id", "ASC"]],
      attributes: ["id", "title", "url", "type"],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async create(data) {
    const course_cat_ids = Array.isArray(data.course_cat_ids)
      ? [
        ...new Set(
          data.course_cat_ids
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n > 0),
        ),
      ]
      : [];

    const affiliatePct =
      data.affiliate_commission !== undefined && data.affiliate_commission !== null
        ? Number(data.affiliate_commission)
        : 0;

    let slug = data.slug != null && String(data.slug).trim() !== "" ? String(data.slug).trim() : null;
    if (slug) {
      slug = await allocateUniqueCourseSlug(slug, null);
    }

    const row = await Course.create({
      title: data.title || "",
      short_title: data.short_title || null,
      slug,
      brief_description: data.brief_description || null,
      description: data.description || null,
      curriculum: data.curriculum || null,
      learn_outcomes: data.learn_outcomes || null,
      requirements: data.requirements || null,
      terms_conditions: data.terms_conditions || null,
      price: data.price ?? 0,
      sale_price: data.sale_price !== undefined ? data.sale_price : null,
      enrolled_count:
        data.enrolled_count !== undefined && data.enrolled_count !== null
          ? Math.max(0, parseInt(String(data.enrolled_count), 10) || 0)
          : 0,
      ratings:
        data.ratings !== undefined && data.ratings !== null && data.ratings !== ''
          ? Number(data.ratings)
          : null,
      rating_users:
        data.rating_users !== undefined && data.rating_users !== null
          ? Math.max(0, parseInt(String(data.rating_users), 10) || 0)
          : 0,
      thumbnail_url: data.thumbnail_url || null,
      youtube_url: data.youtube_url || null,
      language: data.language || null,
      course_type: data.course_type || null,
      taxable: !!data.taxable,
      keywords: data.keywords || null,
      meta_title: data.meta_title || null,
      meta_description: data.meta_description || null,
      meta_keywords: data.meta_keywords || null,
      canonical_url: data.canonical_url || null,
      robots: data.robots || null,
      og_title: data.og_title || null,
      og_description: data.og_description || null,
      og_image_url: data.og_image_url || null,
      faqs: data.faqs || null,
      feedback: data.feedback || null,
      includes_info: data.includes_info || null,
      course_includes: data.course_includes || null,
      certifications: data.certifications || null,
      gateway: data.gateway || null,
      is_published: !!data.is_published,
      hide_from_public: !!data.hide_from_public,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      affiliate_commission: Number.isFinite(affiliatePct) ? affiliatePct : 0,
    });
    const plain = row.get({ plain: true });
    await this.upsertPrimaryAuthorProfile(plain.id, data);

    if (course_cat_ids.length) {
      await CourseCategory.bulkCreate(
        course_cat_ids.map((course_cat_id) => ({
          course_id: plain.id,
          course_cat_id,
        })),
      );
    }

    const enriched = await this.enrichCourseWithAuthors(plain);
    return this.attachCourseCatIds(enriched);
  },

  async update(id, data) {
    const row = await Course.findByPk(id);
    if (!row) return null;
    const updatableFields = [
      "title",
      "short_title",
      "slug",
      "brief_description",
      "description",
      "curriculum",
      "learn_outcomes",
      "requirements",
      "terms_conditions",
      "price",
      "sale_price",
      "enrolled_count",
      "ratings",
      "rating_users",
      "thumbnail_url",
      "youtube_url",
      "language",
      "course_type",
      "taxable",
      "keywords",
      "meta_title",
      "meta_description",
      "meta_keywords",
      "canonical_url",
      "robots",
      "og_title",
      "og_description",
      "og_image_url",
      "faqs",
      "feedback",
      "includes_info",
      "course_includes",
      "certifications",
      "gateway",
      "is_published",
      "hide_from_public",
      "start_date",
      "end_date",
      "affiliate_commission",
    ];
    const updatePayload = {};
    for (const field of updatableFields) {
      if (data[field] === undefined) continue;
      if (field === "slug") {
        const raw =
          data.slug === null || data.slug === undefined || String(data.slug).trim() === ""
            ? null
            : String(data.slug).trim();
        updatePayload.slug = raw ? await allocateUniqueCourseSlug(raw, id) : null;
      } else {
        updatePayload[field] = data[field];
      }
    }
    await row.update(updatePayload);
    await this.upsertPrimaryAuthorProfile(id, data);

    if (data.course_cat_ids !== undefined) {
      const ids = Array.isArray(data.course_cat_ids)
        ? [
          ...new Set(
            data.course_cat_ids
              .map((n) => Number(n))
              .filter((n) => Number.isFinite(n) && n > 0),
          ),
        ]
        : [];
      await CourseCategory.destroy({ where: { course_id: id } });
      if (ids.length) {
        await CourseCategory.bulkCreate(
          ids.map((course_cat_id) => ({ course_id: id, course_cat_id })),
        );
      }
    }

    const enriched = await this.enrichCourseWithAuthors(row.get({ plain: true }));
    return this.attachCourseCatIds(enriched);
  },

  async createBatchFromCurriculum(courseId, data) {
    const course = await Course.findByPk(courseId, {
      attributes: ["id", "title", "curriculum"],
    });
    if (!course) return null;

    let curriculum = [];
    try {
      curriculum =
        typeof course.curriculum === "string"
          ? JSON.parse(course.curriculum)
          : course.curriculum || [];
    } catch {
      curriculum = [];
    }

    if (!Array.isArray(curriculum) || curriculum.length === 0) {
      throw new AppError(
        "Course has no curriculum items. Add curriculum in the course editor first.",
        400,
      );
    }

    const { start_date, meet_link } = data;

    // Auto-compute end date: start + (curriculum.length - 1) days
    let end_date = null;
    if (start_date) {
      const startMs = new Date(start_date).getTime();
      end_date = new Date(startMs + (curriculum.length - 1) * 86400000)
        .toISOString()
        .split("T")[0];
    }

    // Auto-generate batch name
    const nameDate = start_date
      ? new Date(start_date).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      })
      : "New";
    const existingCount = await Batch.count({ where: { course_id: courseId } });
    const batchName =
      existingCount === 0
        ? "Default Batch"
        : `Batch ${existingCount + 1} — ${nameDate}`;

    const batch = await Batch.create({
      course_id: courseId,
      name: batchName,
      start_date: start_date || null,
      end_date,
      meet_link: meet_link || null,
    });

    // Create sessions + recordings from curriculum items
    for (let i = 0; i < curriculum.length; i++) {
      const day = curriculum[i];
      const dayNumber = i + 1;
      const dayTitle = day.title || `Day ${dayNumber}`;

      // New format: day.sections = [{ title, description, videoId, duration }, ...]
      // Old format: flat { title, video, minutes, description }
      const sections = Array.isArray(day.sections) && day.sections.length > 0
        ? day.sections
        : [{ title: dayTitle, description: day.description || '', videoId: day.video || '', duration: day.minutes || '' }];

      for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];
        const session = await Session.create({
          batch_id: batch.id,
          day_number: dayNumber,
          section_index: s,
          title: dayTitle,
          section_title: sec.title || null,
          duration: sec.duration ? parseInt(sec.duration, 10) || null : null,
          scheduled_at: null,
          meet_link: null,
        });

        const urls = collectVideoUrlsFromSection(sec);
        for (const url of urls) {
          await Recording.create({
            session_id: session.id,
            url: String(url),
            source: "vimeo",
            is_visible: true,
          });
        }
      }
    }

    // Return full batch with sessions and recordings
    return this._getBatchesSessionsRecordings(courseId, {
      visibleOnly: false,
    }).then(
      (batches) =>
        batches.find((b) => b.id === batch.id) || batch.get({ plain: true }),
    );
  },

  /**
   * Re-sync batch sessions from the course curriculum.
   * Deletes existing sessions and re-creates them from current curriculum.
   * Preserves recordings whose videoId matches a curriculum section.
   */
  async syncBatchSessions(batchId) {
    const batch = await Batch.findByPk(batchId);
    if (!batch) return null;

    const course = await Course.findByPk(batch.course_id, {
      attributes: ["id", "curriculum"],
    });
    if (!course) return null;

    let curriculum = [];
    try {
      curriculum =
        typeof course.curriculum === "string"
          ? JSON.parse(course.curriculum)
          : course.curriculum || [];
    } catch {
      curriculum = [];
    }

    if (!Array.isArray(curriculum) || curriculum.length === 0) {
      throw new AppError(
        "Course has no curriculum items. Add curriculum in the course editor first.",
        400,
      );
    }

    // Collect existing recordings keyed by (day_number, section_index)
    const existingSessions = await Session.findAll({
      where: { batch_id: batchId },
      include: [{ model: Recording, as: "Recordings", required: false }],
    });

    const existingRecMap = new Map();
    for (const s of existingSessions) {
      const key = `${s.day_number}-${s.section_index}`;
      existingRecMap.set(key, (s.Recordings || []).map((r) => ({
        url: r.url,
        source: r.source,
        is_visible: r.is_visible,
      })));
    }

    // Delete all existing sessions (cascades to recordings via DB or manual)
    for (const s of existingSessions) {
      await Recording.destroy({ where: { session_id: s.id } });
      await s.destroy();
    }

    // Re-create sessions from curriculum
    for (let i = 0; i < curriculum.length; i++) {
      const day = curriculum[i];
      const dayNumber = i + 1;
      const dayTitle = day.title || `Day ${dayNumber}`;

      const sections =
        Array.isArray(day.sections) && day.sections.length > 0
          ? day.sections
          : [
            {
              title: dayTitle,
              description: day.description || "",
              videoId: day.video || "",
              duration: day.minutes || "",
            },
          ];

      for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];
        const session = await Session.create({
          batch_id: batchId,
          day_number: dayNumber,
          section_index: s,
          title: dayTitle,
          section_title: sec.title || null,
          duration: sec.duration ? parseInt(sec.duration, 10) || null : null,
          scheduled_at: null,
          meet_link: null,
        });

        // Try to restore existing recordings for this slot
        const key = `${dayNumber}-${s}`;
        const oldRecs = existingRecMap.get(key);
        if (oldRecs && oldRecs.length > 0) {
          for (const r of oldRecs) {
            await Recording.create({
              session_id: session.id,
              url: r.url,
              source: r.source,
              is_visible: r.is_visible,
            });
          }
        } else {
          const urls = collectVideoUrlsFromSection(sec);
          for (const url of urls) {
            await Recording.create({
              session_id: session.id,
              url: String(url),
              source: "vimeo",
              is_visible: true,
            });
          }
        }
      }
    }

    // Return updated batch
    return this._getBatchesSessionsRecordings(batch.course_id, {
      visibleOnly: false,
    }).then(
      (batches) =>
        batches.find((b) => b.id === batchId) || batch.get({ plain: true }),
    );
  },

  /** Raw batch creation (no auto-session creation). Kept for backward compat. */
  async createBatchRaw(courseId, data) {
    const { name, start_date, end_date, meet_link } = data;
    const row = await Batch.create({
      course_id: courseId,
      name: name || "",
      start_date: start_date || null,
      end_date: end_date || null,
      meet_link: meet_link || null,
    });
    return row.get({ plain: true });
  },

  async updateBatch(id, data) {
    const { name, start_date, end_date, meet_link } = data;
    const row = await Batch.findByPk(id);
    if (!row) return null;
    await row.update({
      ...(name !== undefined && { name }),
      ...(start_date !== undefined && { start_date }),
      ...(end_date !== undefined && { end_date }),
      ...(meet_link !== undefined && { meet_link }),
    });
    return row.get({ plain: true });
  },

  async createSession(batchId, data) {
    const { day_number, section_index, title, section_title, duration, scheduled_at, meet_link } = data;
    const row = await Session.create({
      batch_id: batchId,
      day_number: day_number ?? 1,
      section_index: section_index ?? 0,
      title: title || null,
      section_title: section_title || null,
      duration: duration != null ? parseInt(duration, 10) || null : null,
      scheduled_at: scheduled_at || null,
      meet_link: meet_link || null,
    });
    return row.get({ plain: true });
  },

  async updateSession(id, data) {
    const { day_number, section_index, title, section_title, duration, scheduled_at, meet_link } = data;
    const row = await Session.findByPk(id);
    if (!row) return null;
    await row.update({
      ...(day_number !== undefined && { day_number }),
      ...(section_index !== undefined && { section_index }),
      ...(title !== undefined && { title }),
      ...(section_title !== undefined && { section_title }),
      ...(duration !== undefined && { duration: duration != null ? parseInt(duration, 10) || null : null }),
      ...(scheduled_at !== undefined && { scheduled_at }),
      ...(meet_link !== undefined && { meet_link }),
    });
    return row.get({ plain: true });
  },

  async addRecording(sessionId, data) {
    const { url, source, is_visible } = data;
    const row = await Recording.create({
      session_id: sessionId,
      url: url || "",
      source: source || null,
      is_visible: is_visible ?? true,
    });
    return row.get({ plain: true });
  },

  async updateRecording(recordingId, data) {
    const row = await Recording.findByPk(recordingId);
    if (!row) return null;
    const { url, source, is_visible } = data;
    if (url !== undefined) row.url = url || "";
    if (source !== undefined) row.source = source || null;
    if (is_visible !== undefined) row.is_visible = !!is_visible;
    await row.save();
    return row.get({ plain: true });
  },

  async toggleRecordingVisibility(recordingId, isVisible) {
    const row = await Recording.findByPk(recordingId);
    if (!row) return null;
    row.is_visible = !!isVisible;
    await row.save();
    return row.get({ plain: true });
  },

  async deleteRecording(recordingId) {
    const row = await Recording.findByPk(recordingId);
    if (!row) return false;
    await row.destroy();
    return true;
  },

  async deleteSession(sessionId) {
    const row = await Session.findByPk(sessionId);
    if (!row) return false;
    await Recording.destroy({ where: { session_id: sessionId } });
    await row.destroy();
    return true;
  },

  async deleteBatch(batchId) {
    const row = await Batch.findByPk(batchId);
    if (!row) return false;
    const sessions = await Session.findAll({
      where: { batch_id: batchId },
      attributes: ["id"],
    });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      await Recording.destroy({ where: { session_id: sessionIds } });
    }
    await Session.destroy({ where: { batch_id: batchId } });
    await BatchEnrollment.destroy({ where: { batch_id: batchId } });
    await row.destroy();
    return true;
  },

  // ---- Batch Enrollments ----
  async getBatchEnrollments(batchId) {
    const rows = await BatchEnrollment.findAll({
      where: { batch_id: batchId },
      order: [["enrolled_at", "DESC"]],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async addBatchEnrollment(batchId, userId) {
    const [row, created] = await BatchEnrollment.findOrCreate({
      where: { batch_id: batchId, user_id: userId },
      defaults: { batch_id: batchId, user_id: userId },
    });
    const batch = await Batch.findByPk(batchId, { attributes: ["course_id"] });
    if (batch?.course_id) {
      await syncUserCourseGrant(userId, batch.course_id);
    }
    return { ...row.get({ plain: true }), created };
  },

  async removeBatchEnrollment(enrollmentId) {
    const row = await BatchEnrollment.findByPk(enrollmentId);
    if (!row) return false;
    await row.destroy();
    return true;
  },

  async getEnrollmentsByUser(userId) {
    // 1. Get primary enrollments
    const enrollmentRows = await Enrollment.findAll({
      where: { user_id: userId },
      include: [{ model: Course, as: 'Course', attributes: ['id', 'title'] }],
    });

    // 2. Get batch enrollments (legacy or specific)
    const batchRows = await BatchEnrollment.findAll({
      where: { user_id: userId },
      include: [{ model: Batch, as: 'Batch', include: [{ model: Course, as: 'Course', attributes: ['id', 'title'] }] }],
    });

    // 3. Get generic user_courses (Auth service parity)
    const userCourseRows = await UserCourse.findAll({
      where: { user_id: userId },
    });

    const resultsMap = new Map();

    // Process generic Enrollments first
    for (const r of enrollmentRows) {
      const e = r.get({ plain: true });
      resultsMap.set(String(e.course_id), {
        enrollment_id: e.id,
        course_id: e.course_id,
        course_title: e.Course?.title ?? 'Unknown Course',
        batch_id: null,
        batch_name: null,
        enrolled_at: e.enrolled_at,
      });
    }

    // Layer in Batch info
    for (const r of batchRows) {
      const b = r.get({ plain: true });
      const cid = String(b.Batch?.course_id);
      if (!cid || cid === 'undefined') continue;

      const existing = resultsMap.get(cid);
      resultsMap.set(cid, {
        enrollment_id: existing?.enrollment_id ?? null,
        course_id: Number(cid),
        course_title: b.Batch?.Course?.title ?? existing?.course_title ?? 'Unknown Course',
        batch_id: b.batch_id,
        batch_name: b.Batch?.name ?? null,
        enrolled_at: b.enrolled_at || existing?.enrolled_at,
      });
    }

    // Ensure all user_courses are represented
    for (const r of userCourseRows) {
      const uc = r.get({ plain: true });
      const cid = String(uc.course_id);
      if (!resultsMap.has(cid)) {
        const course = await Course.findByPk(uc.course_id, { attributes: ['id', 'title'] });
        resultsMap.set(cid, {
          enrollment_id: null,
          course_id: Number(uc.course_id),
          course_title: course?.title ?? `Course ${uc.course_id}`,
          batch_id: null,
          batch_name: null,
          enrolled_at: null,
        });
      }
    }

    return Array.from(resultsMap.values()).sort((a, b) => {
      const dateA = a.enrolled_at ? new Date(a.enrolled_at).getTime() : 0;
      const dateB = b.enrolled_at ? new Date(b.enrolled_at).getTime() : 0;
      return dateB - dateA;
    });
  },

  async listBatchesByCourse(courseId) {
    const rows = await Batch.findAll({
      where: { course_id: courseId },
      order: [['created_at', 'DESC']],
      attributes: ['id', 'name', 'course_id', 'start_date', 'end_date', 'created_at'],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async listAllBatches({ courseId, page = 1, limit = 100 } = {}) {
    const where = courseId ? { course_id: courseId } : {};
    const offset = (page - 1) * limit;
    const { count, rows } = await Batch.findAndCountAll({
      where,
      include: [{ model: Course, as: 'Course', required: true, attributes: ['id', 'title'] }],
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });
    return {
      data: rows.map((r) => {
        const b = r.get({ plain: true });
        return { ...b, course_title: b.Course?.title ?? null };
      }),
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
      hasNextPage: offset + rows.length < count,
      hasPreviousPage: page > 1,
    };
  },

  /**
   * Pick the batch a new buyer should be enrolled into for this course.
   * Prefers batches that already have sessions (so a newer empty batch does not
   * win over "Default Batch" from curriculum).
   * Then: earliest upcoming start_date → most recently completed end_date → oldest created batch.
   */
  async selectPurchaseBatch(courseId) {
    const batches = await Batch.findAll({
      where: { course_id: courseId },
      order: [["created_at", "DESC"]],
      raw: true,
    });
    if (batches.length === 0) return null;

    const batchIds = batches.map((b) => b.id);
    const { Op } = require("sequelize");
    const countRows = await Session.findAll({
      attributes: [
        "batch_id",
        [Session.sequelize.fn("COUNT", Session.sequelize.col("Session.id")), "cnt"],
      ],
      where: { batch_id: { [Op.in]: batchIds } },
      group: ["batch_id"],
      raw: true,
    });
    const countMap = new Map(countRows.map((r) => [Number(r.batch_id), Number(r.cnt) || 0]));
    const withSessions = batches.filter((b) => (countMap.get(Number(b.id)) || 0) > 0);
    const pool = withSessions.length > 0 ? withSessions : batches;

    const todayStr = new Date().toISOString().slice(0, 10);

    const upcoming = pool
      .filter((b) => b.start_date && String(b.start_date) >= todayStr)
      .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
    if (upcoming.length > 0) return upcoming[0];

    const completed = pool
      .filter((b) => b.end_date && String(b.end_date) < todayStr)
      .sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)));
    if (completed.length > 0) return completed[0];

    const byCreated = [...pool].sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")),
    );
    return byCreated[0];
  },

  /**
   * Enroll a buyer into a specific batch (or auto-resolve if batchId not given).
   * Called by order-service outbox worker after a successful COURSE_PURCHASED event.
   */
  async autoEnrollInBatch(courseId, userId, batchId = null) {
    let targetBatchId = batchId ? Number(batchId) : null;

    if (targetBatchId) {
      // Confirm the batch still exists and belongs to this course.
      const confirmed = await Batch.findOne({
        where: { id: targetBatchId, course_id: courseId },
        attributes: ["id"],
      });
      if (!confirmed) targetBatchId = null;
    }

    if (!targetBatchId) {
      const picked = await this.selectPurchaseBatch(courseId);
      if (picked) {
        targetBatchId = picked.id;
      }
    }

    let row = null;
    let created = false;
    if (targetBatchId) {
      const [batchRow, batchCreated] = await BatchEnrollment.findOrCreate({
        where: { batch_id: targetBatchId, user_id: userId },
        defaults: { batch_id: targetBatchId, user_id: userId, enrolled_at: new Date() },
      });
      row = batchRow;
      created = batchCreated;
    }

    // Always create a course-level enrollment entry for tracking, even if no batch.
    await Enrollment.findOrCreate({
      where: { user_id: userId, course_id: courseId },
      defaults: { user_id: userId, course_id: courseId, enrolled_at: new Date() }
    });

    await syncUserCourseGrant(userId, courseId);

    if (row) {
      return { ...row.get({ plain: true }), created };
    }
    return { course_id: courseId, user_id: userId, batch_id: null, created: true, note: "No active batch found, but course access granted." };
  },

  /**
   * Look up which batch (if any) a specific user is enrolled into for a course.
   * Returns the batch row (plain) + basic status info, or null.
   */
  async getUserBatchForCourse(courseId, userId) {
    const rows = await BatchEnrollment.findAll({
      where: { user_id: userId },
      include: [
        {
          model: Batch,
          as: "Batch",
          required: true,
          where: { course_id: courseId },
        },
      ],
      order: [["enrolled_at", "DESC"]],
    });
    if (!rows.length) return null;

    const batchIds = rows.map((r) => r.Batch?.id).filter(Boolean);
    if (batchIds.length === 0) return null;

    const { Op } = require("sequelize");
    const countRows = await Session.findAll({
      attributes: [
        "batch_id",
        [Session.sequelize.fn("COUNT", Session.sequelize.col("Session.id")), "cnt"],
      ],
      where: { batch_id: { [Op.in]: batchIds } },
      group: ["batch_id"],
      raw: true,
    });
    const countMap = new Map(countRows.map((r) => [Number(r.batch_id), Number(r.cnt) || 0]));

    let bestBatch = null;
    let bestScore = -1;
    for (const r of rows) {
      const b = r.Batch;
      if (!b) continue;
      const bid = Number(b.id);
      const cnt = countMap.get(bid) || 0;
      const enr = r.enrolled_at ? new Date(r.enrolled_at).getTime() : 0;
      const score = cnt * 1e15 + enr;
      if (score > bestScore) {
        bestScore = score;
        bestBatch = b;
      }
    }
    return bestBatch ? bestBatch.get({ plain: true }) : null;
  },

  /**
   * If the learner is enrolled in a batch with zero sessions but another batch
   * for this course has sessions (e.g. "Default Batch"), move enrollment so
   * progress and player APIs match the slug/sessions behavior.
   */
  async repairUserBatchIfNoSessions(courseId, userId) {
    const cid = Number(courseId);
    const uid = Number(userId);
    if (!Number.isFinite(cid) || cid <= 0 || !Number.isFinite(uid) || uid <= 0) return;

    const current = await this.getUserBatchForCourse(cid, uid);
    if (!current?.id) return;

    const onBatchCount = await Session.count({ where: { batch_id: current.id } });
    if (onBatchCount > 0) return;

    const picked = await this.selectPurchaseBatch(cid);
    if (!picked?.id || Number(picked.id) === Number(current.id)) return;

    const targetCount = await Session.count({ where: { batch_id: picked.id } });
    if (targetCount === 0) return;

    await BatchEnrollment.destroy({ where: { user_id: uid, batch_id: current.id } });
    await BatchEnrollment.findOrCreate({
      where: { batch_id: picked.id, user_id: uid },
      defaults: {
        batch_id: picked.id,
        user_id: uid,
        enrolled_at: new Date(),
      },
    });
  },

  /** Parsed curriculum days (sections, videos[], etc.) for learner-facing APIs. */
  async getCourseCurriculumParsed(courseId) {
    const row = await Course.findByPk(courseId, { attributes: ["id", "curriculum"] });
    if (!row) return [];
    return parseCurriculumDays(row.curriculum);
  },

  async addMaterial(courseId, data) {
    const { title, url, type } = data;
    const row = await Material.create({
      course_id: courseId,
      title: title || null,
      url: url || "",
      type: type || null,
    });
    return row.get({ plain: true });
  },

  // ---- Course Page Settings ----
  async getAllPageSettings() {
    try {
      const rows = await CoursePageSetting.findAll({
        order: [["setting_key", "ASC"]],
      });
      const result = {};
      for (const r of rows) {
        result[r.setting_key] = r.setting_value;
      }
      return result;
    } catch (err) {
      throw mapCoursePageSettingsDbError(err);
    }
  },

  async getPageSetting(key) {
    try {
      const row = await CoursePageSetting.findOne({
        where: { setting_key: key },
      });
      return row ? row.setting_value : null;
    } catch (err) {
      throw mapCoursePageSettingsDbError(err);
    }
  },

  async upsertPageSetting(key, value) {
    const normalizedValue = value === undefined || value === null ? null : String(value);
    try {
      let row = await CoursePageSetting.findOne({ where: { setting_key: key } });
      if (row) {
        row.setting_value = normalizedValue;
        await row.save();
      } else {
        row = await CoursePageSetting.create({
          setting_key: key,
          setting_value: normalizedValue,
        });
      }
      return row.get({ plain: true });
    } catch (err) {
      throw mapCoursePageSettingsDbError(err);
    }
  },

  async createCourseCat(data) {
    const row = await CourseCat.create({
      name: data.name,
      slug:
        data.slug ||
        data.name
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, ""),
      is_featured: data.is_featured ?? false,
    });
    return row.get({ plain: true });
  },

  async updateCourseCat(id, data) {
    const row = await CourseCat.findByPk(id);
    if (!row) return null;
    const updates = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.slug !== undefined) updates.slug = data.slug;
    if (data.is_featured !== undefined)
      updates.is_featured = !!data.is_featured;
    await row.update(updates);
    return row.get({ plain: true });
  },

  async deleteCourseCat(id) {
    const deleted = await CourseCat.destroy({ where: { id } });
    return deleted > 0;
  },

  async listCourseCatsPublic() {
    const rows = await CourseCat.findAll({
      where: { is_featured: true },
      order: [["name", "ASC"]],
      attributes: ["id", "name", "slug", "is_featured"],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async listPublishedByCategory(
    catSlug,
    { page = 1, limit = 9, search = "", sort = "latest", price = "all" } = {},
  ) {
    const { Op } = require("sequelize");
    const { CourseCategory } = require("../models");

    const courseAttrs = [
      "id",
      "title",
      "slug",
      "brief_description",
      "price",
      "sale_price",
      "thumbnail_url",
      "enrolled_count",
      "ratings",
      "language",
      "is_published",
      "curriculum",
    ];

    // ── Build base WHERE clause ──
    const where = { is_published: true, hide_from_public: false };

    // Search filter (title contains)
    if (search && search.trim()) {
      where.title = { [Op.like]: `%${search.trim()}%` };
    }

    // Price filter
    if (price === "free") {
      where.price = 0;
    } else if (price === "0-500") {
      where[Op.and] = [
        ...(where[Op.and] || []),
        {
          [Op.or]: [
            { sale_price: { [Op.gt]: 0, [Op.lte]: 500 } },
            {
              [Op.and]: [
                { sale_price: null },
                { price: { [Op.gt]: 0, [Op.lte]: 500 } },
              ],
            },
          ],
        },
      ];
    } else if (price === "500-1000") {
      where[Op.and] = [
        ...(where[Op.and] || []),
        {
          [Op.or]: [
            { sale_price: { [Op.gt]: 500, [Op.lte]: 1000 } },
            {
              [Op.and]: [
                { sale_price: null },
                { price: { [Op.gt]: 500, [Op.lte]: 1000 } },
              ],
            },
          ],
        },
      ];
    } else if (price === "1000+") {
      where[Op.and] = [
        ...(where[Op.and] || []),
        {
          [Op.or]: [
            { sale_price: { [Op.gt]: 1000 } },
            { [Op.and]: [{ sale_price: null }, { price: { [Op.gt]: 1000 } }] },
          ],
        },
      ];
    }

    // ── Sort order ──
    let order;
    if (sort === "oldest") {
      order = [["id", "ASC"]];
    } else if (sort === "newest") {
      order = [["id", "DESC"]];
    } else if (sort === "popular") {
      order = [
        ["enrolled_count", "DESC"],
        ["created_at", "DESC"],
      ];
    } else {
      // 'latest' (default on /courses) — newest first
      order = [
        ["created_at", "DESC"],
        ["id", "DESC"],
      ];
    }

    // ── Category filter ──
    let courseIds = null; // null = no restriction
    if (catSlug && catSlug !== "all") {
      const cat = await CourseCat.findOne({
        where: { slug: catSlug },
        attributes: ["id"],
      });
      if (!cat) return { data: [], total: 0, page: 1, pageCount: 0 };
      const mappings = await CourseCategory.findAll({
        where: { course_cat_id: cat.id },
        attributes: ["course_id"],
      });
      courseIds = mappings.map((m) => m.course_id);
      if (!courseIds.length)
        return { data: [], total: 0, page: 1, pageCount: 0 };
      where.id = courseIds;
    }

    // ── Paginated query ──
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 9), 24);
    const offset = (safePage - 1) * safeLimit;

    const { count: total, rows } = await Course.findAndCountAll({
      where,
      order,
      attributes: courseAttrs,
      limit: safeLimit,
      offset,
      distinct: true,
    });

    const pageCount = Math.ceil(total / safeLimit);

    const data = rows.map((r) => {
      const d = r.get({ plain: true });
      d.language = normalizeLanguage(d.language);
      return withListingDuration(d);
    });

    return { data, total, page: safePage, pageCount };
  },

  /**
   * Fetch published courses by explicit IDs and/or by course-category IDs.
   * Used by auth-service to resolve "courses included in a membership plan".
   * Returns deduplicated list ordered by id ASC.
   */
  async listByIdsOrCatIds({ ids = [], cat_ids = [] } = {}) {
    const { Op, QueryTypes } = require('sequelize');
    const { sequelize, CourseCategory } = require('../models');

    const courseIdSet = new Set(ids.map(Number).filter(Boolean));

    // Resolve courses belonging to any of the given category IDs
    if (cat_ids.length > 0) {
      const catLinks = await CourseCategory.findAll({
        where: { course_cat_id: { [Op.in]: cat_ids.map(Number).filter(Boolean) } },
        attributes: ['course_id'],
        raw: true,
      });
      for (const link of catLinks) {
        courseIdSet.add(Number(link.course_id));
      }
    }

    if (courseIdSet.size === 0) return [];

    // Use a raw query to easily join course_cats without alias issues.
    // MIN() aggregates are required for MySQL ONLY_FULL_GROUP_BY mode.
    const rows = await sequelize.query(
      `SELECT c.id, c.title, c.slug, c.brief_description, c.thumbnail_url, c.price, c.sale_price,
              MIN(cc.name) AS category_name, MIN(cc.slug) AS category_slug
       FROM courses c
       LEFT JOIN course_categories ccm ON ccm.course_id = c.id
       LEFT JOIN course_cats cc ON cc.id = ccm.course_cat_id
       WHERE c.id IN (:ids) AND c.is_published = 1
       GROUP BY c.id, c.title, c.slug, c.brief_description, c.thumbnail_url, c.price, c.sale_price
       ORDER BY c.id ASC`,
      { replacements: { ids: [...courseIdSet] }, type: QueryTypes.SELECT }
    );

    return rows.map((d) => ({
      id: d.id,
      title: d.title,
      slug: d.slug,
      brief_description: d.brief_description,
      thumbnail_url: d.thumbnail_url,
      price: d.price,
      sale_price: d.sale_price,
      category: d.category_name || null,
      cat_slug: d.category_slug || null,
    }));
  },

  /**
   * Remove a user from all enrollments related to a specific course.
   * Called upon order refund to revoke access.
   */
  async unenrollUser(userId, courseId) {
    const { BatchEnrollment, Batch, Enrollment, UserCourse } = require('../models');
    const { Op } = require('sequelize');

    // 1. Remove from all batches of this course
    const batches = await Batch.findAll({
      where: { course_id: courseId },
      attributes: ['id'],
      raw: true,
    });
    const batchIds = batches.map((b) => b.id);

    if (batchIds.length > 0) {
      await BatchEnrollment.destroy({
        where: {
          user_id: userId,
          batch_id: { [Op.in]: batchIds },
        },
      });
    }

    // 2. Remove primary enrollment record
    await Enrollment.destroy({
      where: { user_id: userId, course_id: courseId }
    });

    // 3. Remove UserCourse record (generic access link)
    await UserCourse.destroy({
      where: { user_id: userId, course_id: courseId }
    });
  },
};

let warnedMissingCoursePageSettingsTable = false;

function isMissingCoursePageSettingsTableError(err) {
  if (!err || err.name !== "SequelizeDatabaseError") return false;
  const code = err.parent?.code;
  const msg = String(err.parent?.sqlMessage || err.message || "");
  if (code === "ER_NO_SUCH_TABLE") return /sc_course_page_settings/i.test(msg);
  return /sc_course_page_settings/i.test(msg) && /doesn't exist/i.test(msg);
}

function mapCoursePageSettingsDbError(err) {
  if (!isMissingCoursePageSettingsTableError(err)) return err;
  if (!warnedMissingCoursePageSettingsTable) {
    warnedMissingCoursePageSettingsTable = true;
    logger.warn(
      "[course-service] Table sc_course_page_settings is missing. Run `npm run ensure-course-page-settings` from study-cafe-api, then restart.",
    );
  }
  return new AppError(
    "Course page settings storage is not initialized. Ask ops to run: npm run ensure-course-page-settings",
    503,
  );
}

module.exports = coursesService;
