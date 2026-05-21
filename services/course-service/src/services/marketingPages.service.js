const { Op } = require('sequelize');
const { AppError } = require('../../../../shared');
const {
  MarketingPage,
  Course,
  CoursePageSetting,
} = require('../models');
const coursesService = require('./courses.service');

function parseJsonField(raw, fallback = null) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function stringifyMeta(meta) {
  if (meta == null) return null;
  if (typeof meta === 'string') return meta.trim() || null;
  return JSON.stringify(meta);
}

function parseMeta(raw) {
  const parsed = parseJsonField(raw, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

/** Normalize slug for storage (lowercase, hyphenated). */
function normalizeSlug(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function allocateUniqueMarketingSlug(baseSlug, excludeId = null) {
  let candidate = normalizeSlug(baseSlug) || 'course';
  let n = 0;
  for (;;) {
    const slug = n === 0 ? candidate : `${candidate}-${n}`;
    const where = { slug };
    if (excludeId != null) where.id = { [Op.ne]: excludeId };
    const existing = await MarketingPage.findOne({ where, attributes: ['id'] });
    if (!existing) return slug;
    n += 1;
    if (n > 200) throw new AppError('Could not allocate a unique marketing page slug', 500);
  }
}

function mapMissingTableError(err) {
  const code = err?.parent?.code || err?.original?.code;
  if (code === 'ER_NO_SUCH_TABLE' && String(err?.sql || '').includes('marketing_pages')) {
    return new AppError(
      'Marketing pages storage is not initialized. Run: npm run ensure-marketing-pages',
      503,
    );
  }
  return err;
}

const MARKETING_COURSE_ATTRS = [
  'id',
  'title',
  'short_title',
  'slug',
  'brief_description',
  'thumbnail_url',
  'youtube_url',
  'price',
  'sale_price',
  'learn_outcomes',
  'includes_info',
  'feedback',
  'faqs',
  'start_date',
  'end_date',
  'enrolled_count',
  'course_includes',
];

async function loadCourseForMarketing(courseId) {
  const row = await Course.findByPk(courseId, {
    attributes: MARKETING_COURSE_ATTRS,
  });
  if (!row) return null;
  const plain = row.get({ plain: true });
  const enriched = await coursesService.enrichCourseWithAuthors(plain);
  return enriched;
}

async function loadPageSettings() {
  try {
    const rows = await CoursePageSetting.findAll({ order: [['setting_key', 'ASC']] });
    const result = {};
    for (const r of rows) {
      result[r.setting_key] = r.setting_value;
    }
    return result;
  } catch (err) {
    throw mapMissingTableError(err);
  }
}

const marketingPagesService = {
  async listInternal() {
    try {
      const rows = await MarketingPage.findAll({
        order: [['updated_at', 'DESC']],
        include: [
          {
            model: Course,
            as: 'Course',
            attributes: ['id', 'title', 'slug', 'is_published'],
          },
        ],
      });
      return rows.map((r) => {
        const p = r.get({ plain: true });
        return {
          id: p.id,
          course_id: p.course_id,
          slug: p.slug,
          is_published: !!p.is_published,
          meta: parseMeta(p.meta),
          course_title: p.Course?.title ?? null,
          course_slug: p.Course?.slug ?? null,
          created_at: p.created_at,
          updated_at: p.updated_at,
        };
      });
    } catch (err) {
      throw mapMissingTableError(err);
    }
  },

  async getByIdInternal(id) {
    try {
      const row = await MarketingPage.findByPk(id, {
        include: [
          {
            model: Course,
            as: 'Course',
            attributes: ['id', 'title', 'slug', 'is_published'],
          },
        ],
      });
      if (!row) return null;
      const p = row.get({ plain: true });
      return {
        id: p.id,
        course_id: p.course_id,
        slug: p.slug,
        is_published: !!p.is_published,
        meta: parseMeta(p.meta),
        course_title: p.Course?.title ?? null,
        course_slug: p.Course?.slug ?? null,
        created_at: p.created_at,
        updated_at: p.updated_at,
      };
    } catch (err) {
      throw mapMissingTableError(err);
    }
  },

  async create(data) {
    const courseId = Number(data.course_id);
    if (!Number.isFinite(courseId) || courseId <= 0) {
      throw new AppError('course_id is required', 400);
    }
    const course = await Course.findByPk(courseId, { attributes: ['id', 'slug', 'title'] });
    if (!course) throw new AppError('Course not found', 404);

    const existingForCourse = await MarketingPage.findOne({ where: { course_id: courseId } });
    if (existingForCourse) {
      throw new AppError('A marketing page already exists for this course', 409);
    }

    const baseSlug =
      data.slug && String(data.slug).trim()
        ? data.slug
        : course.slug || course.title || `course-${courseId}`;
    const slug = await allocateUniqueMarketingSlug(baseSlug);

    try {
      const row = await MarketingPage.create({
        course_id: courseId,
        slug,
        is_published: !!data.is_published,
        meta: stringifyMeta(data.meta),
      });
      return this.getByIdInternal(row.id);
    } catch (err) {
      throw mapMissingTableError(err);
    }
  },

  async update(id, data) {
    const row = await MarketingPage.findByPk(id);
    if (!row) return null;

    const updates = {};
    if (data.is_published !== undefined) updates.is_published = !!data.is_published;
    if (data.meta !== undefined) updates.meta = stringifyMeta(data.meta);

    if (data.course_id !== undefined) {
      const courseId = Number(data.course_id);
      if (!Number.isFinite(courseId) || courseId <= 0) {
        throw new AppError('Invalid course_id', 400);
      }
      const course = await Course.findByPk(courseId, { attributes: ['id'] });
      if (!course) throw new AppError('Course not found', 404);
      const dup = await MarketingPage.findOne({
        where: { course_id: courseId, id: { [Op.ne]: id } },
      });
      if (dup) throw new AppError('Another marketing page already uses this course', 409);
      updates.course_id = courseId;
    }

    if (data.slug !== undefined && String(data.slug).trim()) {
      updates.slug = await allocateUniqueMarketingSlug(data.slug, id);
    }

    try {
      await row.update(updates);
      return this.getByIdInternal(id);
    } catch (err) {
      throw mapMissingTableError(err);
    }
  },

  async delete(id) {
    try {
      const n = await MarketingPage.destroy({ where: { id } });
      return n > 0;
    } catch (err) {
      throw mapMissingTableError(err);
    }
  },

  /**
   * Public payload for /marketing/:slug — course fields + page meta + shared page settings.
   */
  async getPublicBySlug(slug) {
    try {
      const pageRow = await MarketingPage.findOne({
        where: { slug, is_published: true },
      });
      if (!pageRow) return null;

      const page = pageRow.get({ plain: true });
      const course = await loadCourseForMarketing(page.course_id);
      if (!course) return null;

      const pageSettings = await loadPageSettings();
      const alumniLogos = parseJsonField(pageSettings.alumni_logos, []);
      const featuredInLogos = parseJsonField(pageSettings.featured_in_logos, []);
      const galleryRaw = parseJsonField(pageSettings.gallery_images, []);
      const gallery_images = galleryRaw
        .map((item) => {
          if (typeof item === 'string') return item.trim();
          if (item && typeof item === 'object') {
            return String(item.image_url || item.url || item.image || '').trim();
          }
          return '';
        })
        .filter(Boolean);

      return {
        page: {
          id: page.id,
          course_id: page.course_id,
          slug: page.slug,
          meta: parseMeta(page.meta),
        },
        course,
        page_settings: {
          alumni_logos: Array.isArray(alumniLogos) ? alumniLogos : [],
          featured_in_logos: Array.isArray(featuredInLogos) ? featuredInLogos : [],
          gallery_images,
        },
      };
    } catch (err) {
      throw mapMissingTableError(err);
    }
  },
};

module.exports = marketingPagesService;
