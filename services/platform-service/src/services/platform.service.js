const { Op } = require('sequelize');
const { QueryTypes } = require('sequelize');

/**
 * Normalize a plan's `features` value from the DB into a clean string[].
 * Handles every format that may have been stored historically:
 *   - null / undefined              → []
 *   - string[]  (correct format)    → returned as-is
 *   - string[] with HTML items      → each item is HTML-stripped and re-split
 *   - string    (plain or HTML)     → split by HTML block tags / newlines
 */
function normalizeFeatures(raw) {
  if (!raw) return [];

  // Flatten HTML string case
  const value = Array.isArray(raw)
    ? (raw.length === 1 && typeof raw[0] === 'string' && raw[0].includes('<') ? raw[0] : null)
    : typeof raw === 'string'
    ? raw
    : null;

  if (value !== null) {
    const withNewlines = value
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n');

    const plain = withNewlines.replace(/<[^>]+>/g, '');

    const decoded = plain
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"');

    return decoded
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  // ✅ 🔥 CRITICAL FIX: Ensure raw is array
  if (!Array.isArray(raw)) {
    console.warn('normalizeFeatures received non-array:', raw);
    return [];
  }

  return raw
    .map((item) => {
      if (typeof item !== 'string') return String(item);
      if (!item.includes('<')) return item.trim();

      return item
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    })
    .filter((l) => l.length > 0);
}
/**
 * Normalize a plan's `features` value into a structured { mrp, included[], excluded[] } object.
 * Handles every legacy format:
 *   - { mrp, included[], excluded[] }   → returned as-is (cleaned)
 *   - string[]                          → all treated as included, excluded = []
 *   - string (HTML or plain)            → parsed as included lines
 *   - null / undefined                  → { mrp: 0, included: [], excluded: [] }
 */
function normalizeStructuredFeatures(raw) {
  const empty = { mrp: 0, included: [], excluded: [] };
  if (!raw) return empty;

  // Already structured object
  if (!Array.isArray(raw) && typeof raw === 'object') {
    return {
      mrp: Number(raw.mrp) || 0,
      included: Array.isArray(raw.included) ? raw.included.map(String).filter(Boolean) : [],
      excluded: Array.isArray(raw.excluded) ? raw.excluded.map(String).filter(Boolean) : [],
    };
  }

  // Legacy: plain string[] or HTML string → treat all as included
  const lines = normalizeFeatures(raw);
  return { mrp: 0, included: lines, excluded: [] };
}

const { paginate, AppError } = require('../../../../shared');
const {
  sequelize,
  CmsPage,
  State,
  Testimonial,
  FooterData,
  PremiumPlan,
  PlanCourse,
  PlanCourseCategory,
  PlanComparisonFeature,
  PlanFeatureAvailability,
  NewsletterTemplate,
  Banner,
  Faq,
  Article,
  ArticleCategoryMap,
  ArticleTagMap,
  ArticleTypeMap,
  ArticleCourtMap,
  Category,
  Tag,
  ArticleType,
  Court,
  MediaAsset,
  ContactInquiry,
  SeoMetadata,
} = require('../models');

/** Get display_name for one author from users table (same DB). */
async function getAuthorDisplayName(authorId) {
  if (authorId == null) return null;
  const rows = await sequelize.query(
    'SELECT display_name FROM users WHERE id = ? LIMIT 1',
    { replacements: [authorId], type: QueryTypes.SELECT }
  );
  const name = rows[0] && (rows[0].display_name != null && rows[0].display_name !== '') ? rows[0].display_name : null;
  return name;
}

/** Get display_name for many author ids; returns Map<authorId, display_name>. */
async function getAuthorDisplayNamesBatch(authorIds) {
  const uniq = [...new Set(authorIds)].filter((id) => id != null);
  if (uniq.length === 0) return new Map();
  const rows = await sequelize.query(
    'SELECT id, display_name FROM users WHERE id IN (?)',
    { replacements: [uniq], type: QueryTypes.SELECT }
  );
  const map = new Map();
  rows.forEach((r) => { map.set(Number(r.id), r.display_name || null); });
  return map;
}

function toPlain(row) {
  return row ? row.get({ plain: true }) : null;
}

/**
 * Home page data is stored as a CmsPage with slug = 'home'.
 * The `meta` JSON field holds: { hero, features[], stats[], testimonialHighlight }
 * The `content` field can hold raw HTML for the page if needed.
 */

const defaultHero = {
  title: 'Master Your Skills with Professional Courses',
  subtitle: 'Learn from industry experts, get certified, and boost your career with our comprehensive online courses',
  ctaText: 'View Memberships',
  ctaLink: '/plans',
  badge: 'Welcome to StudyCafe Learning Platform',
};

function buildHomeData(page) {
  const m = (page && page.meta && typeof page.meta === 'object') ? page.meta : {};
  const hero = (m.hero && typeof m.hero === 'object')
    ? {
      title: m.hero.title ?? defaultHero.title,
      // subtitle: m.hero.subtitle ?? defaultHero.subtitle,
      ctaText: m.hero.ctaText ?? defaultHero.ctaText,
      description: m.hero.description ?? defaultHero.description,
      ctaLink: m.hero.ctaLink ?? defaultHero.ctaLink,
      imageUrl:  m.hero.backgroundImageUrl ?? null,
      backgroundImageUrl: m.hero.imageUrl ?? null,
      badge: m.hero.subtitle ?? defaultHero.subtitle,
    }
    : { ...defaultHero };

  const features = Array.isArray(m.features)
    ? m.features.map((f, i) => ({
      id: f.id || `f${i + 1}`,
      title: f.title ?? '',
      description: f.description ?? '',
      icon: f.icon ?? null,
      order: f.order ?? i,
    }))
    : [];

  let stats = [];
  if (Array.isArray(m.stats)) {
    stats = m.stats.map((s) => ({
      label: s.label ?? '',
      value: s.value ?? '',
      suffix: s.suffix ?? null,
    }));
  } else if (m.stats && typeof m.stats === 'object') {
    // Fixed display order matching the frontend layout
    const orderedKeys = [
      { key: 'students', label: 'Active Students' },
      { key: 'courses', label: 'Total Courses' },
      { key: 'certificatesIssued', label: 'Certificates Issued' },
      { key: 'successRate', label: 'Success Rate' },
    ];
    stats = orderedKeys
      .filter(({ key }) => m.stats[key] !== undefined)
      .map(({ key, label }) => ({
        label,
        value: String(m.stats[key]),
        suffix: null,
      }));
  }

  return {
    hero,
    ...(features.length > 0 && { features }),
    ...(stats.length > 0 && { stats }),
    ...(page && page.updated_at && { updatedAt: page.updated_at }),
  };
}

async function getHomePublic() {
  const page = await CmsPage.findOne({ where: { slug: 'home' } });
  const data = buildHomeData(page ? page.get({ plain: true }) : null);

  const [testimonialRows, faqRows] = await Promise.all([
    Testimonial.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC']],
      attributes: ['id', 'name', 'role', 'quote', 'avatar_url', 'sort_order'],
    }),
    Faq.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC']],
      attributes: ['id', 'question', 'answer', 'sort_order'],
    }),
  ]);

  data.testimonials = testimonialRows.map((r) => {
    const t = r.get({ plain: true });
    return {
      id: String(t.id),
      quote: t.quote ?? '',
      authorName: t.name ?? '',
      authorRole: t.role ?? null,
      avatarUrl: t.avatar_url ?? null,
      order: t.sort_order ?? 0,
    };
  });

  data.faqs = faqRows.map((r) => {
    const f = r.get({ plain: true });
    return {
      id: String(f.id),
      question: f.question ?? '',
      answer: f.answer ?? '',
      order: f.sort_order ?? 0,
    };
  });

  return data;
}

/** Returns the raw cms_pages row for slug='home' for admin editing. */
async function getHomePageInternal() {
  const page = await CmsPage.findOne({ where: { slug: 'home' } });
  if (!page) return { slug: 'home', title: null, content: null, meta: null };
  return page.get({ plain: true });
}

/** Upsert the cms_pages row for slug='home'. */
async function upsertHomePage(data) {
  const { title, content, meta } = data;
  const [row, created] = await CmsPage.findOrCreate({
    where: { slug: 'home' },
    defaults: { title: title ?? null, content: content ?? null, meta: meta || null },
  });
  if (!created) {
    await row.update({
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(meta !== undefined && { meta }),
    });
  }
  return row.get({ plain: true });
}

async function getStatesPublic() {
  const rows = await State.findAll({
    where: { is_active: true },
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
    attributes: ['id', 'name', 'code', 'country_code'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getStatesInternal() {
  const rows = await State.findAll({
    order: [
      ['sort_order', 'ASC'],
      ['name', 'ASC'],
    ],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function createState(data) {
  const { name, code, country_code, sort_order, is_active } = data;
  const row = await State.create({
    name: name || '',
    code: code || null,
    country_code: country_code || 'IN',
    sort_order: sort_order ?? 0,
    is_active: is_active !== undefined ? !!is_active : true,
  });
  return row.get({ plain: true });
}

async function updateState(id, data) {
  const row = await State.findByPk(id);
  if (!row) return null;
  const { name, code, country_code, sort_order, is_active } = data;
  await row.update({
    ...(name !== undefined && { name }),
    ...(code !== undefined && { code }),
    ...(country_code !== undefined && { country_code }),
    ...(sort_order !== undefined && { sort_order }),
    ...(is_active !== undefined && { is_active: !!is_active }),
  });
  return row.get({ plain: true });
}

async function getTestimonialsPublic(featuredOnly) {
  const where = { is_active: true };
  const rows = await Testimonial.findAll({
    where,
    order: [
      ['sort_order', 'ASC'],
      ['id', 'DESC'],
    ],
    attributes: ['id', 'name', 'role', 'quote', 'avatar_url', 'sort_order'],
  });
  return rows.map(toApi);
}

function toApi(r) {
  const plain = r.get ? r.get({ plain: true }) : r;
  return {
    id: plain.id,
    author_name: plain.name,
    author_role: plain.role,
    content: plain.quote,
    avatar_url: plain.avatar_url,
    sort_order: plain.sort_order,
    is_active: plain.is_active,
    created_at: plain.created_at,
  };
}

async function getTestimonialsInternal() {
  const rows = await Testimonial.findAll({
    order: [
      ['sort_order', 'ASC'],
      ['id', 'DESC'],
    ],
  });
  return rows.map(toApi);
}

async function createTestimonial(data) {
  const row = await Testimonial.create({
    name: data.author_name || '',
    role: data.author_role || null,
    quote: data.content || '',
    avatar_url: data.avatar_url || null,
    sort_order: data.sort_order ?? 0,
    is_active: data.is_active !== undefined ? !!data.is_active : true,
  });
  return toApi(row);
}

async function updateTestimonial(id, data) {
  const row = await Testimonial.findByPk(id);
  if (!row) return null;
  const updates = {};
  if (data.author_name !== undefined) updates.name = data.author_name;
  if (data.author_role !== undefined) updates.role = data.author_role;
  if (data.content !== undefined) updates.quote = data.content;
  if (data.avatar_url !== undefined) updates.avatar_url = data.avatar_url;
  if (data.sort_order !== undefined) updates.sort_order = data.sort_order;
  if (data.is_active !== undefined) updates.is_active = !!data.is_active;
  await row.update(updates);
  return toApi(row);
}

async function deleteTestimonial(id) {
  const deleted = await Testimonial.destroy({ where: { id } });
  return deleted > 0;
}

async function getFooterPublic() {
  const rows = await FooterData.findAll({ order: [['id', 'ASC']] });
  const footer = {};
  for (const r of rows) {
    const p = r.get({ plain: true });
    footer[p.data_key] = p.data_value;
    if (p.meta) footer[`${p.data_key}_meta`] = p.meta;
  }
  return footer;
}

async function getFooterInternal() {
  const rows = await FooterData.findAll({ order: [['data_key', 'ASC']] });
  return rows.map((r) => r.get({ plain: true }));
}

/**
 * Footer dynamic keys (footer_data.data_key) — public GET /platform/footer returns
 * flat { [key]: data_value } plus optional [key]_meta for row.meta.
 *
 * copyright       — plain text (e.g. legal line)
 * tagline         — plain text under logo
 * social_links    — JSON string { twitter, instagram, linkedin, facebook, youtube, telegram }
 * app_links       — JSON string { googlePlay, appStore }
 * important_links — JSON string [{ title, url, column: 1|2 }, ...]
 */
function normalizeFooterDataValue(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function upsertFooter(key, data) {
  let { data_value, meta } = data;
  if (data_value !== undefined) {
    data_value = normalizeFooterDataValue(data_value);
  }
  const [row, created] = await FooterData.findOrCreate({
    where: { data_key: key },
    defaults: {
      data_value: data_value ?? null,
      meta: meta !== undefined ? meta : null,
    },
  });
  if (!created) {
    await row.update({
      ...(data_value !== undefined && { data_value }),
      ...(meta !== undefined && { meta }),
    });
  }
  return row.get({ plain: true });
}

async function getPlansPublic() {
  const rows = await PremiumPlan.findAll({
    where: { is_active: true },
    order: [
      ['sort_order', 'ASC'],
      ['id', 'ASC'],
    ],
    attributes: ['id', 'name', 'slug', 'description', 'price', 'currency', 'duration_days', 'is_lifetime', 'features', 'is_popular', 'sort_order'],
  });

  // Fetch all comparison features ordered by sort_order
  const allCompFeatures = await PlanComparisonFeature.findAll({
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
    attributes: ['id', 'name', 'sort_order'],
  });

  // Fetch all availability rows for the active plan ids
  const planIds = rows.map((r) => r.id);
  const availRows = planIds.length
    ? await PlanFeatureAvailability.findAll({
        where: { plan_id: planIds },
        attributes: ['plan_id', 'feature_id', 'available'],
      })
    : [];

  // Build a map: plan_id -> feature_id -> available (boolean)
  const availMap = new Map();
  for (const a of availRows) {
    const av = a.get({ plain: true });
    if (!availMap.has(av.plan_id)) availMap.set(av.plan_id, new Map());
    availMap.get(av.plan_id).set(av.feature_id, !!av.available);
  }

  return rows.map((r) => {
    const p = r.get({ plain: true });
    const planAvail = availMap.get(p.id) || new Map();
    const comparison_features = allCompFeatures.map((f) => {
      const feat = f.get({ plain: true });
      return { id: feat.id, name: feat.name, available: planAvail.get(feat.id) ?? false };
    });
    return { ...p, features: normalizeStructuredFeatures(p.features), comparison_features };
  });
}

async function getPlanBySlugPublic(slug) {
  const row = await PremiumPlan.findOne({
    where: { slug, is_active: true },
    attributes: ['id', 'name', 'slug', 'description', 'price', 'currency', 'duration_days', 'is_lifetime', 'features', 'is_popular', 'sort_order'],
  });
  if (!row) return null;
  const p = row.get({ plain: true });

  const allCompFeatures = await PlanComparisonFeature.findAll({
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
    attributes: ['id', 'name', 'sort_order'],
  });
  const availRows = await PlanFeatureAvailability.findAll({
    where: { plan_id: p.id },
    attributes: ['plan_id', 'feature_id', 'available'],
  });
  const availMap = new Map();
  for (const a of availRows) {
    const av = a.get({ plain: true });
    availMap.set(av.feature_id, !!av.available);
  }
  const comparison_features = allCompFeatures.map((f) => {
    const feat = f.get({ plain: true });
    return { id: feat.id, name: feat.name, available: availMap.get(feat.id) ?? false };
  });

  return { ...p, features: normalizeStructuredFeatures(p.features), comparison_features };
}

async function getPlansInternal() {
  const rows = await PremiumPlan.findAll({
    order: [
      ['sort_order', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getPlanByIdInternal(id) {
  const row = await PremiumPlan.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true });
  const [courseRows, catRows] = await Promise.all([
    PlanCourse.findAll({ where: { plan_id: id }, attributes: ['course_id'] }),
    PlanCourseCategory.findAll({ where: { plan_id: id }, attributes: ['course_cat_id'] }),
  ]);
  const course_ids = courseRows.map((r) => Number(r.course_id));
  const course_cat_ids = catRows.map((r) => Number(r.course_cat_id));
  return {
    ...p,
    features: normalizeStructuredFeatures(p.features),
    course_ids,
    course_cat_ids,
  };
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function createPlan(data) {
  const slugVal = data.slug || slugify(data.name);
  const pct =
    data.affiliate_commission !== undefined && data.affiliate_commission !== null
      ? Number(data.affiliate_commission)
      : 0;
  const row = await PremiumPlan.create({
    name: data.name || '',
    slug: slugVal,
    description: data.description || null,
    price: data.price ?? 0,
    currency: data.currency || 'INR',
    duration_days: data.duration_days ?? null,
    is_lifetime: data.is_lifetime !== undefined ? !!data.is_lifetime : false,
    features: data.features || null,
    sort_order: data.sort_order ?? 0,
    is_active: data.is_active !== undefined ? !!data.is_active : true,
    affiliate_commission: Number.isFinite(pct) ? pct : 0,
  });
  const planId = row.id;
  const course_ids = Array.isArray(data.course_ids) ? data.course_ids : [];
  const course_cat_ids = Array.isArray(data.course_cat_ids) ? data.course_cat_ids : [];
  if (course_ids.length) {
    await PlanCourse.bulkCreate(course_ids.map((course_id) => ({ plan_id: planId, course_id })));
  }
  if (course_cat_ids.length) {
    await PlanCourseCategory.bulkCreate(course_cat_ids.map((course_cat_id) => ({ plan_id: planId, course_cat_id })));
  }
  const out = row.get({ plain: true });
  return { ...out, course_ids, course_cat_ids };
}

async function updatePlan(id, data) {
  const row = await PremiumPlan.findByPk(id);
  if (!row) return null;
  const updates = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.slug !== undefined) updates.slug = data.slug;
  if (data.description !== undefined) updates.description = data.description;
  if (data.price !== undefined) updates.price = data.price;
  if (data.currency !== undefined) updates.currency = data.currency;
  if (data.duration_days !== undefined) updates.duration_days = data.duration_days;
  if (data.is_lifetime !== undefined) updates.is_lifetime = !!data.is_lifetime;
  if (data.features !== undefined) updates.features = data.features;
  if (data.sort_order !== undefined) updates.sort_order = data.sort_order;
  if (data.is_active !== undefined) updates.is_active = !!data.is_active;
  if (data.is_popular !== undefined) {
    // If marking this plan popular, clear the flag on other plans only — never clear this
    // row in the DB first. Otherwise Sequelize still thinks is_popular is true on the
    // instance and may skip writing it back, leaving the column false after save.
    if (data.is_popular) {
      const planId = Number(id);
      await PremiumPlan.update(
        { is_popular: false },
        { where: { is_popular: true, id: { [Op.ne]: planId } } }
      );
    }
    updates.is_popular = !!data.is_popular;
  }
  if (data.affiliate_commission !== undefined) {
    const pct = Number(data.affiliate_commission);
    updates.affiliate_commission = Number.isFinite(pct) ? pct : 0;
  }
  await row.update(updates);
  if (data.course_ids !== undefined) {
    await PlanCourse.destroy({ where: { plan_id: id } });
    const ids = Array.isArray(data.course_ids) ? data.course_ids : [];
    if (ids.length) {
      await PlanCourse.bulkCreate(ids.map((course_id) => ({ plan_id: id, course_id })));
    }
  }
  if (data.course_cat_ids !== undefined) {
    await PlanCourseCategory.destroy({ where: { plan_id: id } });
    const ids = Array.isArray(data.course_cat_ids) ? data.course_cat_ids : [];
    if (ids.length) {
      await PlanCourseCategory.bulkCreate(ids.map((course_cat_id) => ({ plan_id: id, course_cat_id })));
    }
  }
  return getPlanByIdInternal(id);
}

async function togglePopular(id, is_popular) {
  const row = await PremiumPlan.findByPk(id);
  if (!row) return null;
  const planId = Number(id);
  if (is_popular) {
    await PremiumPlan.update(
      { is_popular: false },
      { where: { is_popular: true, id: { [Op.ne]: planId } } }
    );
  }
  await row.update({ is_popular: !!is_popular });
  return row.get({ plain: true });
}

async function deletePlan(id) {
  const deleted = await PremiumPlan.destroy({ where: { id } });
  return deleted > 0;
}

async function getPlanLinkedCoursesInternal(id) {
  const [courseRows, catRows] = await Promise.all([
    PlanCourse.findAll({ where: { plan_id: id }, attributes: ['course_id'] }),
    PlanCourseCategory.findAll({ where: { plan_id: id }, attributes: ['course_cat_id'] }),
  ]);
  return {
    course_ids: courseRows.map((r) => Number(r.course_id)),
    course_cat_ids: catRows.map((r) => Number(r.course_cat_id)),
  };
}

async function getArticlesPublic(options = {}) {
  const { page = 1, limit = 20, search, category } = options;

  const where = { status: 'publish' };
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    where[Op.or] = [
      { title: { [Op.like]: term } },
      { excerpt: { [Op.like]: term } },
    ];
  }

  // If category slug provided, find the category id first and filter via subquery
  if (category && String(category).trim()) {
    const catRow = await Category.findOne({ where: { slug: String(category).trim() }, attributes: ['id'] });
    if (!catRow) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }
    const mapRows = await ArticleCategoryMap.findAll({ where: { category_id: catRow.id }, attributes: ['article_id'] });
    const articleIds = mapRows.map((r) => r.article_id);
    if (!articleIds.length) {
      return { data: [], total: 0, page, limit, totalPages: 0 };
    }
    where.id = { [Op.in]: articleIds };
  }

  const result = await paginate(Article, {
    where,
    page,
    limit,
    sortBy: 'published_at',
    sortOrder: 'DESC',
    attributes: ['id', 'title', 'slug', 'excerpt', 'thumbnail_url', 'author_id', 'published_at', 'created_at'],
  });

  // Flatten { data, meta } into { data, total, page, limit, totalPages }
  const out = {
    data: result.data || [],
    total: result.meta?.total ?? 0,
    page: result.meta?.page ?? page,
    limit: result.meta?.limit ?? limit,
    totalPages: result.meta?.totalPages ?? 0,
  };

  if (out.data.length > 0) {
    const authorIds = out.data.map((p) => p.author_id).filter(Boolean);
    const authorNames = await getAuthorDisplayNamesBatch(authorIds);

    // Batch-fetch categories for each article
    const articleIds = out.data.map((p) => p.id);
    const catMaps = await ArticleCategoryMap.findAll({ where: { article_id: { [Op.in]: articleIds } }, attributes: ['article_id', 'category_id'] });
    const catIds = [...new Set(catMaps.map((r) => r.category_id))];
    const catRows = catIds.length ? await Category.findAll({ where: { id: { [Op.in]: catIds } }, attributes: ['id', 'name', 'slug'] }) : [];
    const catById = new Map(catRows.map((r) => [Number(r.id), r.get({ plain: true })]));
    const articleCats = new Map();
    for (const m of catMaps) {
      if (!articleCats.has(Number(m.article_id))) articleCats.set(Number(m.article_id), []);
      const cat = catById.get(Number(m.category_id));
      if (cat) articleCats.get(Number(m.article_id)).push(cat);
    }

    out.data = out.data.map((p) => ({
      ...p,
      cover_image_url: p.thumbnail_url,
      author_name: authorNames.get(p.author_id) ?? p.author_id,
      categories: articleCats.get(Number(p.id)) || [],
    }));
  }

  return out;
}

async function getAuthorPublicProfile(authorId) {
  if (authorId == null) return null;
  const rows = await sequelize.query(
    `SELECT id, display_name, name, profession, designation, company, city, state, country, profile_pic_url
     FROM users WHERE id = ? LIMIT 1`,
    { replacements: [authorId], type: QueryTypes.SELECT },
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    display_name: r.display_name || r.name || null,
    name: r.name || null,
    profession: r.profession || null,
    designation: r.designation || null,
    company: r.company || null,
    city: r.city || null,
    state: r.state || null,
    country: r.country || null,
    profile_pic_url: r.profile_pic_url || null,
  };
}

async function getPublishedArticleCountForAuthor(authorId) {
  if (authorId == null) return 0;
  const rows = await sequelize.query(
    'SELECT COUNT(*) AS n FROM articles WHERE author_id = ? AND status = ?',
    { replacements: [authorId, 'publish'], type: QueryTypes.SELECT },
  );
  return Number(rows[0]?.n || 0);
}

async function getPopularArticleTags(limit = 12) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 12));
  const rows = await sequelize.query(
    `SELECT t.id, t.name, t.slug, COUNT(*) AS cnt
     FROM article_tags at
     INNER JOIN tags t ON t.id = at.tag_id
     INNER JOIN articles a ON a.id = at.article_id AND a.status = 'publish'
     GROUP BY t.id, t.name, t.slug
     ORDER BY cnt DESC
     LIMIT ${lim}`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name || '',
    slug: r.slug || null,
    article_count: Number(r.cnt) || 0,
  }));
}

async function buildCategoriesMapsForArticleIds(articleIds) {
  if (!articleIds.length) return new Map();
  const catMaps = await ArticleCategoryMap.findAll({
    where: { article_id: { [Op.in]: articleIds } },
    attributes: ['article_id', 'category_id'],
  });
  const catIds = [...new Set(catMaps.map((m) => m.category_id))];
  const catRows = catIds.length
    ? await Category.findAll({ where: { id: { [Op.in]: catIds } }, attributes: ['id', 'name', 'slug'] })
    : [];
  const catById = new Map(catRows.map((row) => [Number(row.id), row.get({ plain: true })]));
  const articleCats = new Map();
  for (const m of catMaps) {
    if (!articleCats.has(Number(m.article_id))) articleCats.set(Number(m.article_id), []);
    const cat = catById.get(Number(m.category_id));
    if (cat) articleCats.get(Number(m.article_id)).push(cat);
  }
  return articleCats;
}

function attachAccessAndAuthorsToArticles(plainRows, authorNameMap, articleCats, viewer) {
  return plainRows.map((p) => {
    const blog_access_tier = normalizeBlogAccessTier(p.blog_access_tier);
    const access = canReadFullArticle(blog_access_tier, viewer);
    return {
      id: p.id,
      title: p.title || '',
      slug: p.slug || '',
      excerpt: p.excerpt || null,
      sub_heading: p.sub_heading || null,
      meta_description: p.meta_description ?? null,
      thumbnail_url: p.thumbnail_url || null,
      cover_image_url: p.thumbnail_url || null,
      author_id: p.author_id,
      author_name: authorNameMap.get(p.author_id) ?? null,
      published_at: p.published_at,
      created_at: p.created_at,
      updated_at: p.updated_at,
      blog_access_tier,
      access: {
        can_read_full: access.can_read_full,
        reason: access.reason,
        show_read_more_cta: !access.can_read_full && blog_access_tier === 'premium',
      },
      categories: articleCats.get(Number(p.id)) || [],
      description_preview: p.description_preview ?? null,
    };
  });
}

/**
 * Blog landing (`currentSlug` unset): latest hero + sidebar + author for that hero.
 * Article detail (`currentSlug` set): sidebar + author for that slug; `hero` null (page uses full article).
 * Uses optional JWT (optionalWebUser) for premium access flags on list cards.
 */
async function getBlogSpotlightFeed(viewer, options = {}) {
  const recentLimit = Math.min(20, Math.max(1, Number(options.recentLimit) || 3));
  const allLimit = Math.min(30, Math.max(1, Number(options.allLimit) || 6));
  const authorRecentLimit = Math.min(20, Math.max(1, Number(options.authorRecentLimit) || 5));
  const tagLimit = Math.min(30, Math.max(1, Number(options.tagLimit) || 12));
  const currentSlug = options.currentSlug && String(options.currentSlug).trim();

  const popular_tags = await getPopularArticleTags(tagLimit);

  /** Context: single article page — lists exclude this id; author block matches this article. */
  if (currentSlug) {
    const focusRow = await Article.findOne({
      where: { slug: currentSlug, status: 'publish' },
      attributes: [
        'id', 'title', 'slug', 'excerpt', 'content', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
        'published_at', 'created_at', 'updated_at', 'blog_access_tier',
      ],
    });
    if (!focusRow) {
      return {
        hero: null,
        recent_posts: [],
        all_posts: [],
        author: null,
        author_recent_articles: [],
        popular_tags,
      };
    }
    const focus = focusRow.get({ plain: true });
    const focusId = Number(focus.id);

    const moreRows = await Article.findAll({
      where: { status: 'publish', id: { [Op.ne]: focusId } },
      attributes: [
        'id', 'title', 'slug', 'excerpt', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
        'published_at', 'created_at', 'updated_at', 'blog_access_tier',
      ],
      order: [['published_at', 'DESC'], ['id', 'DESC']],
      limit: recentLimit + allLimit,
      offset: 0,
    });
    const morePlain = moreRows.map((r) => r.get({ plain: true }));
    const recentPlain = morePlain.slice(0, recentLimit);
    const allPlain = morePlain.slice(recentLimit, recentLimit + allLimit);

    const authorRecentRows = focus.author_id
      ? await Article.findAll({
        where: {
          status: 'publish',
          author_id: focus.author_id,
          id: { [Op.ne]: focusId },
        },
        attributes: [
          'id', 'title', 'slug', 'excerpt', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
          'published_at', 'created_at', 'updated_at', 'blog_access_tier',
        ],
        order: [['published_at', 'DESC'], ['id', 'DESC']],
        limit: authorRecentLimit,
      })
      : [];
    const authorRecentPlain = authorRecentRows.map((r) => r.get({ plain: true }));

    const poolIds = [...new Set([focusId, ...recentPlain.map((x) => Number(x.id)), ...allPlain.map((x) => Number(x.id)), ...authorRecentPlain.map((x) => Number(x.id))])];
    const authorIds = [...new Set([
      focus.author_id,
      ...recentPlain.map((x) => x.author_id),
      ...allPlain.map((x) => x.author_id),
      ...authorRecentPlain.map((x) => x.author_id),
    ].filter((id) => id != null))];

    const [authorNameMap, articleCats, authorProfile, authorCount] = await Promise.all([
      getAuthorDisplayNamesBatch(authorIds),
      buildCategoriesMapsForArticleIds(poolIds),
      focus.author_id ? getAuthorPublicProfile(focus.author_id) : Promise.resolve(null),
      focus.author_id ? getPublishedArticleCountForAuthor(focus.author_id) : Promise.resolve(0),
    ]);

    return {
      hero: null,
      recent_posts: attachAccessAndAuthorsToArticles(recentPlain, authorNameMap, articleCats, viewer),
      all_posts: attachAccessAndAuthorsToArticles(allPlain, authorNameMap, articleCats, viewer),
      author: authorProfile
        ? { ...authorProfile, published_article_count: authorCount }
        : null,
      author_recent_articles: attachAccessAndAuthorsToArticles(authorRecentPlain, authorNameMap, articleCats, viewer),
      popular_tags,
    };
  }

  const heroRow = await Article.findOne({
    where: { status: 'publish' },
    attributes: [
      'id', 'title', 'slug', 'excerpt', 'content', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
      'published_at', 'created_at', 'updated_at', 'blog_access_tier',
    ],
    order: [
      ['published_at', 'DESC'],
      ['id', 'DESC'],
    ],
  });

  if (!heroRow) {
    return {
      hero: null,
      recent_posts: [],
      all_posts: [],
      author: null,
      author_recent_articles: [],
      popular_tags,
    };
  }

  const hero = heroRow.get({ plain: true });
  const heroId = Number(hero.id);

  const moreRows = await Article.findAll({
    where: { status: 'publish', id: { [Op.ne]: heroId } },
    attributes: [
      'id', 'title', 'slug', 'excerpt', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
      'published_at', 'created_at', 'updated_at', 'blog_access_tier',
    ],
    order: [
      ['published_at', 'DESC'],
      ['id', 'DESC'],
    ],
    limit: recentLimit + allLimit,
    offset: 0,
  });

  const morePlain = moreRows.map((r) => r.get({ plain: true }));
  const recentPlain = morePlain.slice(0, recentLimit);
  const allPlain = morePlain.slice(recentLimit, recentLimit + allLimit);

  const authorRecentRows = hero.author_id
    ? await Article.findAll({
      where: {
        status: 'publish',
        author_id: hero.author_id,
        id: { [Op.ne]: heroId },
      },
      attributes: [
        'id', 'title', 'slug', 'excerpt', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
        'published_at', 'created_at', 'updated_at', 'blog_access_tier',
      ],
      order: [['published_at', 'DESC'], ['id', 'DESC']],
      limit: authorRecentLimit,
    })
    : [];

  const authorRecentPlain = authorRecentRows.map((r) => r.get({ plain: true }));
  const allPieces = [hero, ...recentPlain, ...allPlain, ...authorRecentPlain];
  const poolIds = [...new Set(allPieces.map((x) => Number(x.id)))];
  const authorIds = [...new Set(allPieces.map((x) => x.author_id).filter((id) => id != null))];

  const [authorNameMap, articleCats, authorProfile, authorCount] = await Promise.all([
    getAuthorDisplayNamesBatch(authorIds),
    buildCategoriesMapsForArticleIds(poolIds),
    hero.author_id ? getAuthorPublicProfile(hero.author_id) : Promise.resolve(null),
    hero.author_id ? getPublishedArticleCountForAuthor(hero.author_id) : Promise.resolve(0),
  ]);

  const heroCard = attachAccessAndAuthorsToArticles([hero], authorNameMap, articleCats, viewer)[0];
  heroCard.description_preview = buildDescriptionPreviewFromArticleRow(hero, 560);

  return {
    hero: heroCard,
    recent_posts: attachAccessAndAuthorsToArticles(recentPlain, authorNameMap, articleCats, viewer),
    all_posts: attachAccessAndAuthorsToArticles(allPlain, authorNameMap, articleCats, viewer),
    author: authorProfile
      ? { ...authorProfile, published_article_count: authorCount }
      : null,
    author_recent_articles: attachAccessAndAuthorsToArticles(authorRecentPlain, authorNameMap, articleCats, viewer),
    popular_tags,
  };
}

function extractRelatedIds(content) {
  if (typeof content !== 'string' || !content.length) return [];
  const ids = [];
  const re = /\[related\s+id=['"](\d+)['"]\]/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const id = parseInt(m[1], 10);
    if (!Number.isNaN(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * Replace [related id="N"] shortcodes in the article body with inline HTML links.
 * Resolves WP post IDs to article slugs and renders "Also Read" styled links.
 */
function normalizeBlogAccessTier(raw) {
  const v = String(raw || 'free').toLowerCase();
  return v === 'premium' ? 'premium' : 'free';
}

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripRelatedShortcodesAndMarkers(html) {
  let s = String(html || '');
  s = s.replace(/\[related\s+id=['"]\d+['"]\]/gi, ' ');
  s = s.replace(/<div[^>]*related-article-inline[^>]*>[\s\S]*?<\/div>/gi, ' ');
  return s;
}

function sanitizePreviewPlain(text) {
  if (!text) return '';
  let s = String(text).replace(/\[related\s+id=['"]\d+['"]\]/gi, ' ');
  s = s.replace(/\bAlso\s+Read\b[:\s]*/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const MIN_PROPER_DESC_LEN = 60;
const BODY_SNIPPET_LEN = 150;

function buildBodySnippetPlain(contentHtml, maxLen = BODY_SNIPPET_LEN) {
  const body = stripTags(stripRelatedShortcodesAndMarkers(contentHtml || '')).trim();
  const cleaned = sanitizePreviewPlain(body);
  if (!cleaned) return '';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function teaserFromExcerptSubMetaOnly(p) {
  const title = stripTags(p.title || '').toLowerCase();
  const pick = (s) => {
    const t = stripTags(s || '').trim();
    if (!t || t.toLowerCase() === title) return '';
    return t;
  };
  let ex = pick(p.excerpt);
  const sub = pick(p.sub_heading);
  const meta = pick(p.meta_description);
  let text = ex;
  if (ex.length < 80) {
    text = [ex, sub, meta].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }
  return text ? sanitizePreviewPlain(text) : '';
}

/**
 * Hero / list preview: excerpt + sub + meta when substantive; else a short body snippet (no related / Also read).
 */
function buildDescriptionPreviewFromArticleRow(p, maxLen = 560) {
  const fromFields = teaserFromExcerptSubMetaOnly(p);
  if (fromFields && fromFields.length >= MIN_PROPER_DESC_LEN) {
    return fromFields.length > maxLen ? `${fromFields.slice(0, maxLen - 1)}…` : fromFields;
  }
  const snippet = buildBodySnippetPlain(p.content || '', BODY_SNIPPET_LEN);
  if (snippet) return snippet;
  return fromFields || null;
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPremiumPreviewHtml(excerpt, fullContent) {
  if (excerpt && String(excerpt).trim()) return String(excerpt);
  const plain = stripTags(stripRelatedShortcodesAndMarkers(fullContent));
  const cut = plain.length > 560 ? `${plain.slice(0, 560)}…` : plain;
  return `<p>${escapeHtmlText(cut)}</p>`;
}

async function getRelatedArticlesForArticle(articleId, limit = 4) {
  const RELATED_ATTRS = [
    'id', 'title', 'slug', 'thumbnail_url', 'excerpt',
    'sub_heading', 'author_id', 'published_at', 'updated_at', 'content',
  ];

  const maps = await ArticleCategoryMap.findAll({
    where: { article_id: articleId },
    attributes: ['category_id'],
  });
  const catIds = [...new Set(maps.map((m) => Number(m.category_id)))].filter((n) => Number.isFinite(n));

  let rows = [];

  // Try same-category articles first
  if (catIds.length) {
    const sibs = await ArticleCategoryMap.findAll({
      where: { category_id: { [Op.in]: catIds }, article_id: { [Op.ne]: articleId } },
      attributes: ['article_id'],
      limit: 48,
    });
    const candidateIds = [...new Set(sibs.map((s) => Number(s.article_id)))].filter((n) => Number.isFinite(n));
    if (candidateIds.length) {
      rows = await Article.findAll({
        where: { id: { [Op.in]: candidateIds }, status: 'publish' },
        attributes: RELATED_ATTRS,
        order: [['published_at', 'DESC']],
        limit,
      });
    }
  }

  // Fallback: latest published articles (excluding current)
  if (!rows.length) {
    rows = await Article.findAll({
      where: { status: 'publish', id: { [Op.ne]: articleId } },
      attributes: RELATED_ATTRS,
      order: [['published_at', 'DESC'], ['id', 'DESC']],
      limit,
    });
  }

  if (!rows.length) return [];

  // Resolve author display names
  const authorIds = [...new Set(rows.map((r) => r.get({ plain: true }).author_id).filter(Boolean))];
  const authorNameMap = authorIds.length ? await getAuthorDisplayNamesBatch(authorIds) : new Map();

  return rows.map((r) => {
    const x = r.get({ plain: true });
    return {
      id: x.id,
      title: x.title || '',
      slug: x.slug || '',
      thumbnail_url: x.thumbnail_url || null,
      cover_image_url: x.thumbnail_url || null,
      excerpt: x.excerpt || null,
      sub_heading: x.sub_heading || null,
      author_name: authorNameMap.get(x.author_id) ?? null,
      published_at: x.published_at || null,
      updated_at: x.updated_at || null,
      description_preview: buildDescriptionPreviewFromArticleRow(x, 280),
    };
  });
}

function canReadFullArticle(tier, viewer) {
  const t = normalizeBlogAccessTier(tier);
  if (t !== 'premium') return { can_read_full: true, reason: 'free' };
  if (!viewer) return { can_read_full: false, reason: 'premium_locked' };
  if (['admin', 'super_admin'].includes(viewer.role)) return { can_read_full: true, reason: 'admin' };
  if (viewer.hasActiveMembership) return { can_read_full: true, reason: 'membership' };
  return { can_read_full: false, reason: 'premium_locked' };
}

async function embedRelatedArticles(content) {
  if (typeof content !== 'string' || !content.length) return content;
  const relatedIds = extractRelatedIds(content);
  if (!relatedIds.length) return content;

  // Fetch all referenced articles in one query
  const rows = await Article.findAll({
    where: { [Op.or]: [{ wp_post_id: relatedIds }, { id: relatedIds }] },
    attributes: ['id', 'wp_post_id', 'title', 'slug', 'thumbnail_url'],
  });
  const byWpId = new Map();
  const byId = new Map();
  rows.forEach((r) => {
    const p = r.get({ plain: true });
    if (p.wp_post_id != null) byWpId.set(Number(p.wp_post_id), p);
    byId.set(Number(p.id), p);
  });

  // Replace each [related id="N"] shortcode with an HTML block (cafestudy-fe uses /blogs/:slug)
  const replaced = content.replace(/\[related\s+id=['"](\d+)['"]\]/gi, (match, rawId) => {
    const n = Number(rawId);
    const article = byWpId.get(n) || byId.get(n);
    if (!article) return ''; // remove unresolvable shortcodes
    const slug = String(article.slug || '').trim();
    const href = `/blogs/${encodeURIComponent(slug)}`;
    return `<div class="related-article-inline"><p class="related-heading">Also Read</p><a href="${href}" class="related-link">${escapeHtmlText(article.title || '')}</a></div>`;
  });
  return replaced;
}

/**
 * Sanitise article HTML that may have been pasted from ChatGPT or other AI tools.
 * Strips layout-breaking CSS classes (flex, grid, columns, etc.) and removes
 * wrapper divs with data-* attributes that come from the source page.
 */
function sanitizeArticleHtml(html) {
  if (typeof html !== 'string' || !html.length) return html;

  let out = html;

  // 1. Remove class attributes that contain layout-breaking Tailwind / CSS classes
  //    Matches class="..." where the value contains flex, grid, gap-, grow, min-w, etc.
  // Do not match `text-base` here — TipTap / pasted prose often uses it for sizing; stripping
  // removes the entire class attribute and flattens typography (bold/colour utilities).
  out = out.replace(/\s*class="[^"]*(?:flex|grid|gap-|grow|shrink|min-w|min-h|max-w-\(|pb-25|scroll-mt|focus:|pointer-events|z-0|agent-turn|text-message|text-token|dark:prose|markdown-new-styling|prose-invert|@w-)[^"]*"/gi, '');

  // 2. Remove data-* attributes (data-testid, data-turn-id, data-message-*, etc.)
  out = out.replace(/\s*data-[a-z][a-z0-9-]*="[^"]*"/gi, '');

  // 3. Remove dir="auto" and tabindex attributes
  out = out.replace(/\s*dir="auto"/gi, '');
  out = out.replace(/\s*tabindex="[^"]*"/gi, '');

  // 4. Unwrap empty/redundant wrapper <div> and <section> tags left after attribute removal.
  //    Keep only <div class="related-article-inline"> and similar known patterns.
  //    Replace <div>\n<section>\n ... \n</section>\n</div> wrapper chains.
  out = out.replace(/<(div|section)\s*>\s*(?=<(div|section|p|h[1-6]|ul|ol|table|blockquote))/gi, '');

  // Close matching end tags for the unwrapped opens (greedy, removes trailing close tags
  // that pair with the removed opens). This is approximate but handles the common case.
  // We'll do multiple passes to peel layers.
  for (let i = 0; i < 6; i++) {
    // Remove </div> or </section> that appears right before another closing tag or EOF,
    // but only if there's no matching open tag.
    out = out.replace(/<\/(div|section)>\s*(<\/(div|section)>)/gi, '$2');
  }

  // 5. Clean up any remaining empty divs/sections (no content, no meaningful children)
  out = out.replace(/<(div|section)\s*>\s*<\/\1>/gi, '');

  // 6. Collapse excessive whitespace / blank lines
  out = out.replace(/(\r?\n){3,}/g, '\n\n');

  return out.trim();
}

async function getArticleBySlugPublic(slug, viewer = null) {
  const row = await Article.findOne({
    where: { slug, status: 'publish' },
    attributes: [
      'id', 'title', 'slug', 'excerpt', 'content', 'sub_heading', 'thumbnail_url', 'author_id',
      'published_at', 'meta_title', 'meta_description', 'created_at', 'updated_at',
      'rel_download_url', 'upload_url', 'blog_access_tier',
    ],
  });
  if (!row) return null;
  const p = row.get({ plain: true });
  
  // Extract TOC and inject anchor IDs into the content
  const tocItems = [];
  let htmlWithIds = p.content || '';
  if (typeof htmlWithIds === 'string') {
    htmlWithIds = htmlWithIds.replace(/<(h[23])(?:\s+[^>]*)?>([\s\S]*?)<\/h[23]>/gi, (match, tag, inner) => {
      const rawText = inner.replace(/<[^>]*>?/gm, "").trim();
      if (rawText) {
        const id = rawText
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .trim();
        
        tocItems.push({
          id,
          text: rawText,
          level: tag.toLowerCase() === 'h2' ? 2 : 3,
        });
        return `<${tag} id="${id}">${inner}</${tag}>`;
      }
      return match;
    });
  }

  const blog_access_tier = normalizeBlogAccessTier(p.blog_access_tier);
  const access = canReadFullArticle(blog_access_tier, viewer);
  const authorName = await getAuthorDisplayName(p.author_id);
  const fullBody = sanitizeArticleHtml(await embedRelatedArticles(htmlWithIds));
  const related_articles = access.can_read_full ? [] : await getRelatedArticlesForArticle(p.id, 4);
  const body = access.can_read_full ? fullBody : buildPremiumPreviewHtml(p.excerpt, htmlWithIds);
  const out = {
    ...p,
    blog_access_tier,
    access: {
      can_read_full: access.can_read_full,
      reason: access.reason,
      show_read_more_cta: !access.can_read_full && blog_access_tier === 'premium',
      // Downloads are always premium-only regardless of article tier
      can_download: viewer
        ? (['admin', 'super_admin'].includes(viewer.role) || !!viewer.hasActiveMembership)
        : false,
    },
    body,
    toc: tocItems,
    cover_image_url: p.thumbnail_url,
    author_name: authorName ?? p.author_id,
    download_url: p.rel_download_url || p.upload_url || null,
  };
  if (related_articles.length) out.related_articles = related_articles;
  return out;
}

const UP_NEXT_LIST_ATTRS = [
  'id', 'title', 'slug', 'excerpt', 'sub_heading', 'meta_description', 'thumbnail_url', 'author_id',
  'published_at', 'created_at', 'updated_at', 'blog_access_tier',
];

/**
 * "Up next" suggestions for article detail / blog cards.
 * Order: (1) same published category, newest first; (2) same author; (3) latest published site-wide.
 * Excludes the current article. Respects optional viewer JWT for premium vs free access flags.
 */
async function getUpNextArticlesBySlugPublic(slug, viewer = null, rawLimit) {
  const parsed = parseInt(rawLimit, 10);
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
  /** At least 3, at most 10; default 6 so we usually fill ≥3 from the DB. */
  const limit = Math.min(10, Math.max(3, requested));
  const focusRow = await Article.findOne({
    where: { slug, status: 'publish' },
    attributes: ['id', 'author_id'],
  });
  if (!focusRow) return [];
  const articleId = Number(focusRow.get('id'));
  const authorId = focusRow.get('author_id');

  const picked = [];
  const pickedIds = new Set([articleId]);

  const takeFromRows = (rows) => {
    for (const r of rows) {
      const p = r.get({ plain: true });
      const id = Number(p.id);
      if (pickedIds.has(id)) continue;
      pickedIds.add(id);
      picked.push(p);
      if (picked.length >= limit) return true;
    }
    return false;
  };

  const maps = await ArticleCategoryMap.findAll({
    where: { article_id: articleId },
    attributes: ['category_id'],
  });
  const catIds = [...new Set(maps.map((m) => Number(m.category_id)))].filter((n) => Number.isFinite(n));

  if (picked.length < limit && catIds.length) {
    const sibs = await ArticleCategoryMap.findAll({
      where: { category_id: { [Op.in]: catIds }, article_id: { [Op.ne]: articleId } },
      attributes: ['article_id'],
      limit: 240,
      raw: true,
    });
    const candidateIds = [...new Set(sibs.map((s) => Number(s.article_id)))].filter((n) => Number.isFinite(n));
    if (candidateIds.length) {
      const rows = await Article.findAll({
        where: { id: { [Op.in]: candidateIds }, status: 'publish' },
        attributes: UP_NEXT_LIST_ATTRS,
        order: [['published_at', 'DESC'], ['id', 'DESC']],
      });
      takeFromRows(rows);
    }
  }

  if (picked.length < limit && authorId != null) {
    const rows = await Article.findAll({
      where: {
        status: 'publish',
        author_id: authorId,
        id: { [Op.notIn]: [...pickedIds] },
      },
      attributes: UP_NEXT_LIST_ATTRS,
      order: [['published_at', 'DESC'], ['id', 'DESC']],
      limit: Math.max(limit * 3, 15),
    });
    takeFromRows(rows);
  }

  if (picked.length < limit) {
    const rows = await Article.findAll({
      where: {
        status: 'publish',
        id: { [Op.notIn]: [...pickedIds] },
      },
      attributes: UP_NEXT_LIST_ATTRS,
      order: [['published_at', 'DESC'], ['id', 'DESC']],
      limit: Math.max(limit * 4, 24),
    });
    takeFromRows(rows);
  }

  const plain = picked.slice(0, limit);
  if (!plain.length) return [];

  const authorIds = [...new Set(plain.map((p) => p.author_id).filter(Boolean))];
  const authorNameMap = authorIds.length ? await getAuthorDisplayNamesBatch(authorIds) : new Map();
  const articleCats = await buildCategoriesMapsForArticleIds(plain.map((p) => Number(p.id)));

  const ids = [...new Set(plain.map((p) => Number(p.id)))];
  const contentRows = ids.length
    ? await Article.findAll({
      where: { id: { [Op.in]: ids } },
      attributes: ['id', 'content'],
    })
    : [];
  const contentById = new Map(
    contentRows.map((r) => {
      const x = r.get({ plain: true });
      return [Number(x.id), x.content || ''];
    }),
  );

  const enrichedPlain = plain.map((p) => ({
    ...p,
    description_preview: buildDescriptionPreviewFromArticleRow(
      { ...p, content: contentById.get(Number(p.id)) || '' },
      560,
    ),
  }));

  return attachAccessAndAuthorsToArticles(enrichedPlain, authorNameMap, articleCats, viewer);
}

const ARTICLE_LIST_ATTRS = ['id', 'title', 'slug', 'excerpt', 'thumbnail_url', 'author_id', 'status', 'published_at', 'created_at', 'updated_at', 'blog_access_tier'];
const SORTABLE_ARTICLE_COLUMNS = ['id', 'title', 'slug', 'created_at', 'updated_at', 'status', 'published_at'];

function buildArticlesWhere(options = {}) {
  const { status, search } = options;
  const where = {};
  if (status) where.status = status;
  if (search && String(search).trim()) {
    const term = `%${String(search).trim()}%`;
    where[Op.or] = [
      { title: { [Op.like]: term } },
      { excerpt: { [Op.like]: term } },
      { slug: { [Op.like]: term } },
    ];
  }
  return where;
}

function normalizeSortColumn(sortBy) {
  if (!sortBy || typeof sortBy !== 'string') return 'created_at';
  const col = sortBy.trim();
  return SORTABLE_ARTICLE_COLUMNS.includes(col) ? col : 'created_at';
}

async function getArticlesInternal(options = {}) {
  const {
    status,
    page = 1,
    limit = 10,
    search,
    sortBy,
    sortOrder = 'DESC',
  } = options;

  const where = buildArticlesWhere({ status, search });
  const orderColumn = normalizeSortColumn(sortBy);
  const orderDir = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const result = await paginate(Article, {
    where,
    page,
    limit,
    sortBy: orderColumn,
    sortOrder: orderDir,
    attributes: ARTICLE_LIST_ATTRS,
  });

  if (result.data && result.data.length > 0) {
    const authorIds = result.data.map((r) => r.author_id).filter(Boolean);
    const authorNames = await getAuthorDisplayNamesBatch(authorIds);
    result.data = result.data.map((r) => ({
      ...r,
      author_name: authorNames.get(r.author_id) ?? r.author_id,
    }));
  }

  return result;
}

async function getArticleByIdInternal(id) {
  const row = await Article.findByPk(id);
  if (!row) return null;
  const p = row.get({ plain: true });

  // Resolve related article shortcodes for admin display
  const relatedIds = extractRelatedIds(p.content);
  const relatedRows = relatedIds.length
    ? await Article.findAll({
      where: { [Op.or]: [{ wp_post_id: relatedIds }, { id: relatedIds }] },
      attributes: ['id', 'wp_post_id', 'title', 'slug'],
    })
    : [];
  const byWpId = new Map();
  const byId = new Map();
  relatedRows.forEach((r) => {
    const rp = r.get({ plain: true });
    if (rp.wp_post_id != null) byWpId.set(Number(rp.wp_post_id), rp);
    byId.set(Number(rp.id), rp);
  });
  const relatedArticles = [];
  const seen = new Set();
  for (const rid of relatedIds) {
    const n = Number(rid);
    const match = byWpId.get(n) || byId.get(n);
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      relatedArticles.push({ id: match.id, title: match.title || '', slug: match.slug || '' });
    }
  }

  const [catRows, tagRows, typeRows, courtRows, authorName] = await Promise.all([
    ArticleCategoryMap.findAll({ where: { article_id: id }, attributes: ['category_id'] }),
    ArticleTagMap.findAll({ where: { article_id: id }, attributes: ['tag_id'] }),
    ArticleTypeMap.findAll({ where: { article_id: id }, attributes: ['article_type_id'] }),
    ArticleCourtMap.findAll({ where: { article_id: id }, attributes: ['court_id'] }),
    getAuthorDisplayName(p.author_id),
  ]);
  const tagIds = tagRows.map((r) => Number(r.tag_id));
  const tagRecords = tagIds.length
    ? await Tag.findAll({ where: { id: tagIds }, attributes: ['id', 'name'] })
    : [];
  const tagNameById = new Map(tagRecords.map((r) => [Number(r.id), r.name || '']));
  // Single tags array { id, name } so client doesn't need to zip two arrays
  const tags = tagIds.map((id) => ({ id, name: tagNameById.get(id) ?? '' }));

  let parsedCitation = null;
  if (p.citation) {
    try {
      parsedCitation = JSON.parse(p.citation);
    } catch (e) {
      parsedCitation = { case_citation: p.citation };
    }
  }

  const result = {
    ...p,
    citation: parsedCitation,
    category_ids: catRows.map((r) => Number(r.category_id)),
    tag_ids: tagIds,
    tags,
    article_type_ids: typeRows.map((r) => Number(r.article_type_id)),
    court_ids: courtRows.map((r) => Number(r.court_id)),
    author_name: authorName ?? p.author_id,
  };
  if (relatedArticles.length) result.related_articles = relatedArticles;
  return result;
}

async function createArticle(data) {
  const slugVal = data.slug || slugify(data.title);
  const row = await Article.create({
    title: data.title || '',
    slug: slugVal,
    excerpt: data.excerpt || null,
    content: data.content ?? data.body ?? null,
    thumbnail_url: data.thumbnail_url ?? data.cover_image_url ?? null,
    author_id: data.author_id ?? null,
    sub_heading: data.sub_heading ?? null,
    status: data.status || 'draft',
    published_at: data.published_at || null,
    meta_title: data.meta_title || null,
    meta_description: data.meta_description || null,
    meta_keywords: data.meta_keywords || null,
    citation: data.citation ? (typeof data.citation === 'string' ? data.citation : JSON.stringify(data.citation)) : null,
    blog_access_tier: normalizeBlogAccessTier(data.blog_access_tier),
  });
  const articleId = row.id;
  const category_ids = Array.isArray(data.category_ids) ? data.category_ids : [];
  const tag_ids = Array.isArray(data.tag_ids) ? data.tag_ids : [];
  const article_type_ids = Array.isArray(data.article_type_ids) ? data.article_type_ids : [];
  const court_ids = Array.isArray(data.court_ids) ? data.court_ids : [];
  if (category_ids.length) await ArticleCategoryMap.bulkCreate(category_ids.map((category_id) => ({ article_id: articleId, category_id })));
  if (tag_ids.length) await ArticleTagMap.bulkCreate(tag_ids.map((tag_id) => ({ article_id: articleId, tag_id })));
  if (article_type_ids.length) await ArticleTypeMap.bulkCreate(article_type_ids.map((article_type_id) => ({ article_id: articleId, article_type_id })));
  if (court_ids.length) await ArticleCourtMap.bulkCreate(court_ids.map((court_id) => ({ article_id: articleId, court_id })));
  return getArticleByIdInternal(articleId);
}

async function updateArticle(id, data) {
  const row = await Article.findByPk(id);
  if (!row) return null;
  const updates = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.slug !== undefined) updates.slug = data.slug;
  if (data.excerpt !== undefined) updates.excerpt = data.excerpt;
  if (data.content !== undefined) updates.content = data.content;
  if (data.body !== undefined) updates.content = data.body;
  if (data.thumbnail_url !== undefined) updates.thumbnail_url = data.thumbnail_url;
  if (data.cover_image_url !== undefined) updates.thumbnail_url = data.cover_image_url;
  if (data.author_id !== undefined) updates.author_id = data.author_id;
  if (data.sub_heading !== undefined) updates.sub_heading = data.sub_heading;
  if (data.status !== undefined) updates.status = data.status;
  if (data.published_at !== undefined) updates.published_at = data.published_at;
  if (data.meta_title !== undefined) updates.meta_title = data.meta_title;
  if (data.meta_description !== undefined) updates.meta_description = data.meta_description;
  if (data.meta_keywords !== undefined) updates.meta_keywords = data.meta_keywords;
  if (data.blog_access_tier !== undefined) updates.blog_access_tier = normalizeBlogAccessTier(data.blog_access_tier);
  if (data.rel_download_url !== undefined) updates.rel_download_url = data.rel_download_url || null;
  if (data.citation !== undefined) updates.citation = data.citation ? (typeof data.citation === 'string' ? data.citation : JSON.stringify(data.citation)) : null;
  await row.update(updates);
  if (data.category_ids !== undefined) {
    await ArticleCategoryMap.destroy({ where: { article_id: id } });
    const ids = Array.isArray(data.category_ids) ? data.category_ids : [];
    if (ids.length) await ArticleCategoryMap.bulkCreate(ids.map((category_id) => ({ article_id: id, category_id })));
  }
  if (data.tag_ids !== undefined) {
    await ArticleTagMap.destroy({ where: { article_id: id } });
    const ids = Array.isArray(data.tag_ids) ? data.tag_ids : [];
    if (ids.length) await ArticleTagMap.bulkCreate(ids.map((tag_id) => ({ article_id: id, tag_id })));
  }
  if (data.article_type_ids !== undefined) {
    await ArticleTypeMap.destroy({ where: { article_id: id } });
    const ids = Array.isArray(data.article_type_ids) ? data.article_type_ids : [];
    if (ids.length) await ArticleTypeMap.bulkCreate(ids.map((article_type_id) => ({ article_id: id, article_type_id })));
  }
  if (data.court_ids !== undefined) {
    await ArticleCourtMap.destroy({ where: { article_id: id } });
    const ids = Array.isArray(data.court_ids) ? data.court_ids : [];
    if (ids.length) await ArticleCourtMap.bulkCreate(ids.map((court_id) => ({ article_id: id, court_id })));
  }
  return getArticleByIdInternal(id);
}

async function deleteArticle(id) {
  const deleted = await Article.destroy({ where: { id } });
  return deleted > 0;
}

async function getArticleCategories() {
  const rows = await Category.findAll({
    order: [['name', 'ASC']],
    attributes: ['id', 'name', 'slug'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getArticleCategoryById(id) {
  const row = await Category.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function createArticleCategory(data) {
  const slugVal = data.slug || slugify(data.name);
  const row = await Category.create({
    name: data.name || '',
    slug: slugVal,
    parent_id: data.parent_id || null,
  });
  return row.get({ plain: true });
}

async function updateArticleCategory(id, data) {
  const row = await Category.findByPk(id);
  if (!row) return null;
  await row.update({
    ...(data.name !== undefined && { name: data.name }),
    ...(data.slug !== undefined && { slug: data.slug }),
    ...(data.parent_id !== undefined && { parent_id: data.parent_id }),
  });
  return row.get({ plain: true });
}

async function deleteArticleCategory(id) {
  // Remove junction entries first
  await ArticleCategoryMap.destroy({ where: { category_id: id } });
  const deleted = await Category.destroy({ where: { id } });
  return deleted > 0;
}

async function getTagsInternal() {
  const rows = await Tag.findAll({
    order: [['name', 'ASC']],
    attributes: ['id', 'name', 'slug'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getArticleTypesInternal() {
  const rows = await ArticleType.findAll({
    order: [['name', 'ASC']],
    attributes: ['id', 'name', 'slug'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getCourtsInternal() {
  const rows = await Court.findAll({
    order: [['name', 'ASC']],
    attributes: ['id', 'name', 'slug'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getFaqsPublic() {
  const rows = await Faq.findAll({
    where: { is_active: true },
    order: [['sort_order', 'ASC'], ['id', 'DESC']],
    attributes: ['id', 'question', 'answer', 'sort_order'],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getFaqsInternal() {
  const rows = await Faq.findAll({
    order: [['sort_order', 'ASC'], ['id', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getFaqByIdInternal(id) {
  const row = await Faq.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function createFaq(data) {
  const row = await Faq.create({
    question: data.question || '',
    answer: data.answer || '',
    sort_order: data.sort_order ?? 0,
    is_active: data.is_active !== undefined ? !!data.is_active : true,
  });
  return row.get({ plain: true });
}

async function updateFaq(id, data) {
  const row = await Faq.findByPk(id);
  if (!row) return null;
  await row.update({
    ...(data.question !== undefined && { question: data.question }),
    ...(data.answer !== undefined && { answer: data.answer }),
    ...(data.sort_order !== undefined && { sort_order: data.sort_order }),
    ...(data.is_active !== undefined && { is_active: !!data.is_active }),
  });
  return row.get({ plain: true });
}

async function deleteFaq(id) {
  const deleted = await Faq.destroy({ where: { id } });
  return deleted > 0;
}

async function createContactInquiry(data) {
  const row = await ContactInquiry.create({
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    mobile_number: data.mobile_number,
    country_code: data.country_code || 'IN',
    subject: data.subject || null,
    message: data.message,
    status: 'new',
  });
  return row.get({ plain: true });
}

async function getContactInquiry() {
  const rows = await ContactInquiry.findAll({
    order: [['id', 'DESC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}
// ── SEO Metadata ───────────────────────────────────────────────────

function normalizeSlugCandidates(slug) {
  const raw = String(slug || '').trim();
  if (!raw) return [];
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const withoutSlash = withSlash.slice(1);
  return [...new Set([raw, withSlash, withoutSlash].filter(Boolean))];
}

function canonicalSlug(slug) {
  const raw = String(slug || '').trim();
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

async function checkSlugNotUsedByModule(slug) {
  const candidates = normalizeSlugCandidates(slug);
  if (!candidates.length) return { conflict: false };

  const articleMatch = await Article.findOne({
    where: { slug: { [Op.in]: candidates } },
    attributes: ['slug'],
    raw: true,
  });
  if (articleMatch?.slug) {
    return { conflict: true, type: 'article', slug: articleMatch.slug };
  }

  const courseRows = await sequelize.query(
    'SELECT slug FROM courses WHERE slug IN (:slugs) LIMIT 1',
    {
      replacements: { slugs: candidates },
      type: QueryTypes.SELECT,
    }
  );
  if (courseRows?.length) {
    return { conflict: true, type: 'course', slug: courseRows[0].slug };
  }

  return { conflict: false };
}

async function getSeoMetadataInternal() {
  const rows = await SeoMetadata.findAll({ order: [['id', 'DESC']] });
  return rows.map((r) => r.get({ plain: true }));
}

async function getSeoMetadataByIdInternal(id) {
  const row = await SeoMetadata.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function getSeoMetadataBySlugPublic(slug) {
  // Normalize: try exact match first, then with leading slash, then without
  const candidates = [
    slug,
    slug.startsWith('/') ? slug : `/${slug}`,
    slug.startsWith('/') ? slug.slice(1) : slug,
  ];
  const { Op } = require('sequelize');
  const row = await SeoMetadata.findOne({ where: { page_slug: { [Op.in]: candidates } } });
  return row ? row.get({ plain: true }) : null;
}

async function createSeoMetadata(data) {
  const conflict = await checkSlugNotUsedByModule(data.page_slug);
  if (conflict.conflict) {
    throw new AppError(
      `Slug '${conflict.slug}' is already used by a ${conflict.type}. Use the ${conflict.type}'s own SEO meta fields instead.`,
      409
    );
  }

  const row = await SeoMetadata.create({
    page_name: data.page_name,
    page_slug: data.page_slug,
    meta_title: data.meta_title,
    meta_description: data.meta_description || null,
    meta_keywords: data.meta_keywords || null,
    canonical_url: data.canonical_url || null,
    og_title: data.og_title || null,
    og_description: data.og_description || null,
    og_image_url: data.og_image_url || null,
    robots: data.robots || 'index, follow',
  });
  return row.get({ plain: true });
}

async function updateSeoMetadata(id, data) {
  const row = await SeoMetadata.findByPk(id);
  if (!row) return null;

  if (data.page_slug !== undefined) {
    const existingSlug = row.get('page_slug');
    const slugUnchanged = canonicalSlug(existingSlug) === canonicalSlug(data.page_slug);
    if (!slugUnchanged) {
      const conflict = await checkSlugNotUsedByModule(data.page_slug);
      if (conflict.conflict) {
        throw new AppError(
          `Slug '${conflict.slug}' is already used by a ${conflict.type}. Use the ${conflict.type}'s own SEO meta fields instead.`,
          409
        );
      }
    }
  }

  await row.update({
    ...(data.page_name !== undefined && { page_name: data.page_name }),
    ...(data.page_slug !== undefined && { page_slug: data.page_slug }),
    ...(data.meta_title !== undefined && { meta_title: data.meta_title }),
    ...(data.meta_description !== undefined && { meta_description: data.meta_description }),
    ...(data.meta_keywords !== undefined && { meta_keywords: data.meta_keywords }),
    ...(data.canonical_url !== undefined && { canonical_url: data.canonical_url }),
    ...(data.og_title !== undefined && { og_title: data.og_title }),
    ...(data.og_description !== undefined && { og_description: data.og_description }),
    ...(data.og_image_url !== undefined && { og_image_url: data.og_image_url }),
    ...(data.robots !== undefined && { robots: data.robots }),
  });
  return row.get({ plain: true });
}

async function deleteSeoMetadata(id) {
  const deleted = await SeoMetadata.destroy({ where: { id } });
  return deleted > 0;
}

// ── Comparison Features ─────────────────────────────────────────────

async function listComparisonFeatures() {
  const rows = await PlanComparisonFeature.findAll({
    order: [['sort_order', 'ASC'], ['id', 'ASC']],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function createComparisonFeature({ name, sort_order }) {
  const row = await PlanComparisonFeature.create({ name, sort_order: sort_order ?? 0 });
  return row.get({ plain: true });
}

async function updateComparisonFeature(id, { name, sort_order }) {
  const row = await PlanComparisonFeature.findByPk(id);
  if (!row) return null;
  await row.update({ name, sort_order });
  return row.get({ plain: true });
}

async function deleteComparisonFeature(id) {
  await PlanFeatureAvailability.destroy({ where: { feature_id: id } });
  const deleted = await PlanComparisonFeature.destroy({ where: { id } });
  return deleted > 0;
}

async function setFeatureAvailability(planId, featureId, available) {
  const [row] = await PlanFeatureAvailability.upsert({ plan_id: planId, feature_id: featureId, available: available ? 1 : 0 });
  return row ? row.get({ plain: true }) : { plan_id: planId, feature_id: featureId, available };
}

async function listPlansByIds(ids) {
  if (!ids || ids.length === 0) return [];
  const rows = await PremiumPlan.findAll({
    where: { id: { [Op.in]: ids.map(Number).filter(Boolean) } },
    attributes: ['id', 'name', 'slug'],
    raw: true,
  });
  return rows;
}

module.exports = {
  home: {
    getHomePublic,
    getHomePageInternal,
    upsertHomePage,
  },
  states: {
    getStatesPublic,
    getStatesInternal,
    createState,
    updateState,
  },
  testimonials: {
    getTestimonialsPublic,
    getTestimonialsInternal,
    createTestimonial,
    updateTestimonial,
    deleteTestimonial,
  },
  faqs: {
    getFaqsPublic,
    getFaqsInternal,
    getFaqByIdInternal,
    createFaq,
    updateFaq,
    deleteFaq,
  },
  contactInquiries: {
    createContactInquiry,
    getContactInquiry,
  },
  seo: {
    getSeoMetadataInternal,
    getSeoMetadataByIdInternal,
    getSeoMetadataBySlugPublic,
    createSeoMetadata,
    updateSeoMetadata,
    deleteSeoMetadata,
  },
  footer: {
    getFooterPublic,
    getFooterInternal,
    upsertFooter,
  },
  plans: {
    getPlansPublic,
    getPlanBySlugPublic,
    getPlansInternal,
    getPlanByIdInternal,
    createPlan,
    updatePlan,
    togglePopular,
    deletePlan,
    getPlanLinkedCoursesInternal,
    listPlansByIds,
  },
  comparisonFeatures: {
    listComparisonFeatures,
    createComparisonFeature,
    updateComparisonFeature,
    deleteComparisonFeature,
    setFeatureAvailability,
  },
  articles: {
    getArticlesPublic,
    getBlogSpotlightFeed,
    getArticleBySlugPublic,
    getUpNextArticlesBySlugPublic,
    getArticlesInternal,
    getArticleByIdInternal,
    createArticle,
    updateArticle,
    deleteArticle,
  },
  articleCategories: {
    getArticleCategories,
    getArticleCategoryById,
    createArticleCategory,
    updateArticleCategory,
    deleteArticleCategory,
  },
  tags: { getTagsInternal },
  articleTypes: { getArticleTypesInternal },
  courts: { getCourtsInternal },
  cmsPages: {
    getCmsPagesInternal,
    getCmsPageBySlug,
    upsertCmsPageBySlug,
  },
  mediaAssets: {
    getMediaAssetsInternal,
    createMediaAsset,
    deleteMediaAsset,
  },
  banners: {
    getBannersPublic,
    getBannerByIdentifierPublic,
    getBannersInternal,
    getBannerByIdInternal,
    createBanner,
    updateBanner,
    deleteBanner,
  },
};

// ── CMS pages ───────────────────────────────────────────────────────

async function getCmsPagesInternal() {
  const rows = await CmsPage.findAll({ order: [['slug', 'ASC']] });
  return rows.map((r) => r.get({ plain: true }));
}

async function getCmsPageBySlug(slug) {
  const row = await CmsPage.findOne({ where: { slug } });
  return row ? row.get({ plain: true }) : null;
}

async function upsertCmsPageBySlug(slug, data) {
  const { title, content, meta } = data;
  const [row, created] = await CmsPage.findOrCreate({
    where: { slug },
    defaults: {
      title: title ?? null,
      content: content ?? null,
      meta: meta || null,
    },
  });
  if (!created) {
    await row.update({
      ...(title !== undefined && { title }),
      ...(content !== undefined && { content }),
      ...(meta !== undefined && { meta }),
    });
  }
  return row.get({ plain: true });
}

// ── Media Assets ────────────────────────────────────────────────────

async function getMediaAssetsInternal(category) {
  const where = category ? { category } : {};
  const rows = await MediaAsset.findAll({ where, order: [['created_at', 'DESC']] });
  return rows.map((r) => r.get({ plain: true }));
}

async function createMediaAsset({ url, label, category = 'icon' }) {
  const row = await MediaAsset.create({ url, label, category });
  return row.get({ plain: true });
}

async function deleteMediaAsset(id) {
  const row = await MediaAsset.findByPk(id);
  if (!row) return null;
  await row.destroy();
  return { id };
}

// ── Banners ─────────────────────────────────────────────────────────

async function getBannersPublic() {
  const rows = await Banner.findAll({
    where: { is_active: true },
    order: [["created_at", "DESC"]],
  });
  return rows.map((r) => r.get({ plain: true }));
}

async function getBannerByIdentifierPublic(identifier) {
  const row = await Banner.findOne({
    where: { identifier, is_active: true },
  });
  return row ? row.get({ plain: true }) : null;
}

async function getBannersInternal() {
  const rows = await Banner.findAll({ order: [["created_at", "DESC"]] });
  return rows.map((r) => r.get({ plain: true }));
}

async function getBannerByIdInternal(id) {
  const row = await Banner.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function createBanner(data) {
  const row = await Banner.create(data);
  return row.get({ plain: true });
}

async function updateBanner(id, data) {
  const row = await Banner.findByPk(id);
  if (!row) return null;
  await row.update(data);
  return row.get({ plain: true });
}

async function deleteBanner(id) {
  const row = await Banner.findByPk(id);
  if (!row) return null;
  await row.destroy();
  return { id };
}

