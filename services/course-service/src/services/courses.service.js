const {
  Course,
  CourseAuthor,
  CourseCat,
  Batch,
  Session,
  Recording,
  Material,
  CoursePageSetting,
  BatchEnrollment,
} = require("../models");
const { QueryTypes } = require("sequelize");

function normalizeLanguage(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (value.length === 1 && typeof value[0] === "string") {
      const v = value[0];
      try {
        const p = JSON.parse(v);
        if (Array.isArray(p)) return p;
      } catch {}
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
    } catch {}
    if (value.includes(","))
      return value
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);
    return [value];
  }
  return [];
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
      const hasProfileValues =
        data.author_name !== undefined ||
        data.author_role !== undefined ||
        data.author_bio !== undefined ||
        data.author_image !== undefined;

      if (hasProfileValues) {
        const err = new Error("author_user_id is required to update author profile");
        err.statusCode = 400;
        throw err;
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
      where: { is_published: true },
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
      ],
    });
    return rows.map((r) => {
      const d = r.get({ plain: true });
      d.language = normalizeLanguage(d.language);
      return d;
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
        "created_at",
        "language",
      ],
    });

    return rows.map((r) => {
      const d = r.get({ plain: true });
      d.language = normalizeLanguage(d.language);
      return d;
    });
  },

  async listCourseCats() {
    const rows = await CourseCat.findAll({
      order: [["name", "ASC"]],
      attributes: ["id", "name", "slug", "is_featured"],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async getById(id) {
    const row = await Course.findOne({ where: { id, is_published: true } });
    if (!row) return null;
    const d = row.get({ plain: true });
    d.language = normalizeLanguage(d.language);
    return this.enrichCourseWithAuthors(d);
  },

  async getBySlug(slug) {
    const row = await Course.findOne({ where: { slug, is_published: true } });
    if (!row) return null;
    const d = row.get({ plain: true });
    d.language = normalizeLanguage(d.language);
    return this.enrichCourseWithAuthors(d);
  },

  async getSessionsBySlug(slug) {
    const course = await Course.findOne({
      where: { slug, is_published: true },
      attributes: ["id"],
    });
    if (!course) return null;
    return this._getBatchesSessionsRecordings(course.id, { visibleOnly: true });
  },

  async getByIdInternal(id) {
    const row = await Course.findByPk(id);
    if (!row) return null;
    const d = row.get({ plain: true });
    // d.language = normalizeLanguage(d.language);
    return this.enrichCourseWithAuthors(d);
  },

  async getSessionsByCourseId(courseId) {
    const course = await Course.findOne({
      where: { id: courseId, is_published: true },
      attributes: ["id"],
    });
    if (!course) return null;
    return this._getBatchesSessionsRecordings(courseId, { visibleOnly: true });
  },

  /** Same as getSessionsByCourseId but without is_published filter (for admin). */
  async getSessionsByCourseIdInternal(courseId) {
    const course = await Course.findByPk(courseId, { attributes: ["id"] });
    if (!course) return null;
    return this._getBatchesSessionsRecordings(courseId, { visibleOnly: false });
  },

  async _getBatchesSessionsRecordings(courseId, { visibleOnly = false } = {}) {
    const batches = await Batch.findAll({
      where: { course_id: courseId },
      order: [["created_at", "ASC"]],
    });

    const result = [];
    for (const b of batches) {
      const sessions = await Session.findAll({
        where: { batch_id: b.id },
        order: [["day_number", "ASC"]],
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
          title: s.title,
          scheduled_at: s.scheduled_at,
          meet_link: s.meet_link,
          recordings: (s.Recordings || []).map((r) => ({
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

  async getMaterialsByCourseId(courseId) {
    const course = await Course.findOne({
      where: { id: courseId, is_published: true },
      attributes: ["id"],
    });
    if (!course) return null;
    const rows = await Material.findAll({
      where: { course_id: courseId },
      order: [["id", "ASC"]],
      attributes: ["id", "title", "url", "type"],
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  async create(data) {
    const row = await Course.create({
      title: data.title || "",
      short_title: data.short_title || null,
      slug: data.slug || null,
      brief_description: data.brief_description || null,
      description: data.description || null,
      curriculum: data.curriculum || null,
      learn_outcomes: data.learn_outcomes || null,
      requirements: data.requirements || null,
      terms_conditions: data.terms_conditions || null,
      price: data.price ?? 0,
      sale_price: data.sale_price !== undefined ? data.sale_price : null,
      thumbnail_url: data.thumbnail_url || null,
      youtube_url: data.youtube_url || null,
      language: data.language || null,
      course_type: data.course_type || null,
      taxable: !!data.taxable,
      keywords: data.keywords || null,
      faqs: data.faqs || null,
      feedback: data.feedback || null,
      includes_info: data.includes_info || null,
      course_includes: data.course_includes || null,
      certifications: data.certifications || null,
      gateway: data.gateway || null,
      is_published: !!data.is_published,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
    });
    const plain = row.get({ plain: true });
    await this.upsertPrimaryAuthorProfile(plain.id, data);
    return this.enrichCourseWithAuthors(plain);
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
      "thumbnail_url",
      "youtube_url",
      "language",
      "course_type",
      "taxable",
      "keywords",
      "faqs",
      "feedback",
      "includes_info",
      "course_includes",
      "certifications",
      "gateway",
      "is_published",
      "start_date",
      "end_date",
    ];
    const updatePayload = {};
    for (const field of updatableFields) {
      if (data[field] !== undefined) {
        updatePayload[field] = data[field];
      }
    }
    await row.update(updatePayload);
    await this.upsertPrimaryAuthorProfile(id, data);
    return this.enrichCourseWithAuthors(row.get({ plain: true }));
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
      const err = new Error(
        "Course has no curriculum items. Add curriculum in the course editor first.",
      );
      err.statusCode = 400;
      throw err;
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
      const item = curriculum[i];
      const session = await Session.create({
        batch_id: batch.id,
        day_number: i + 1,
        title: item.title || `Day ${i + 1}`,
        scheduled_at: null,
        meet_link: null,
      });

      // Create recording from curriculum video if present
      if (item.video) {
        await Recording.create({
          session_id: session.id,
          url: String(item.video),
          source: "vimeo",
          is_visible: false,
        });
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
    const { day_number, title, scheduled_at, meet_link } = data;
    const row = await Session.create({
      batch_id: batchId,
      day_number: day_number ?? 1,
      title: title || null,
      scheduled_at: scheduled_at || null,
      meet_link: meet_link || null,
    });
    return row.get({ plain: true });
  },

  async updateSession(id, data) {
    const { day_number, title, scheduled_at, meet_link } = data;
    const row = await Session.findByPk(id);
    if (!row) return null;
    await row.update({
      ...(day_number !== undefined && { day_number }),
      ...(title !== undefined && { title }),
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
      is_visible: is_visible ?? false,
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
    return { ...row.get({ plain: true }), created };
  },

  async removeBatchEnrollment(enrollmentId) {
    const row = await BatchEnrollment.findByPk(enrollmentId);
    if (!row) return false;
    await row.destroy();
    return true;
  },

  async autoEnrollInBatch(courseId, userId) {
    const batches = await Batch.findAll({
      where: { course_id: courseId },
      order: [["created_at", "DESC"]],
    });
    if (batches.length === 0) return null;

    const activeBatch = batches[0];
    const [row, created] = await BatchEnrollment.findOrCreate({
      where: { batch_id: activeBatch.id, user_id: userId },
      defaults: { batch_id: activeBatch.id, user_id: userId },
    });
    return { ...row.get({ plain: true }), created };
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
    const rows = await CoursePageSetting.findAll({
      order: [["setting_key", "ASC"]],
    });
    const result = {};
    for (const r of rows) {
      result[r.setting_key] = r.setting_value;
    }
    return result;
  },

  async getPageSetting(key) {
    const row = await CoursePageSetting.findOne({
      where: { setting_key: key },
    });
    return row ? row.setting_value : null;
  },

  async upsertPageSetting(key, value) {
    const [row] = await CoursePageSetting.upsert(
      { setting_key: key, setting_value: value },
      { returning: true },
    );
    return row.get({ plain: true });
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
    ];

    // ── Build base WHERE clause ──
    const where = { is_published: true };

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
    } else {
      // 'latest' (default) — most enrolled first, then newest
      order = [
        ["enrolled_count", "DESC"],
        ["created_at", "DESC"],
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
      return d;
    });

    return { data, total, page: safePage, pageCount };
  },
};

module.exports = coursesService;
