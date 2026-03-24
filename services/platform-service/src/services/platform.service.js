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

  // Flatten: if it's a single-element array wrapping a big HTML string, unwrap it
  const value = Array.isArray(raw)
    ? (raw.length === 1 && typeof raw[0] === 'string' && raw[0].includes('<') ? raw[0] : null)
    : typeof raw === 'string' ? raw : null;

  if (value !== null) {
    // value is an HTML or plain string — parse it
    const withNewlines = value
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n');
    const plain = withNewlines.replace(/<[^>]+>/g, '');
    const decoded = plain
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    return decoded.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  }

  // It's a proper string[] — strip HTML from each item just in case
  return raw
    .map((item) => {
      if (typeof item !== 'string') return String(item);
      if (!item.includes('<')) return item.trim();
      const plain = item.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      return plain;
    })
    .filter((l) => l.length > 0);
}
const { paginate } = require('../../../../shared');
const {
  sequelize,
  CmsPage,
  State,
  Testimonial,
  FooterData,
  PremiumPlan,
  PlanCourse,
  PlanCourseCategory,
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
      subtitle: m.hero.subtitle ?? defaultHero.subtitle,
      ctaText: m.hero.ctaText ?? defaultHero.ctaText,
      ctaLink: m.hero.ctaLink ?? defaultHero.ctaLink,
      imageUrl: m.hero.imageUrl ?? null,
      badge: m.hero.badge ?? defaultHero.badge,
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

async function upsertFooter(key, data) {
  const { data_value, meta } = data;
  const [row, created] = await FooterData.findOrCreate({
    where: { data_key: key },
    defaults: { data_value: data_value ?? null, meta: meta || null },
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
  return rows.map((r) => {
    const p = r.get({ plain: true });
    return { ...p, features: normalizeFeatures(p.features) };
  });
}

async function getPlanBySlugPublic(slug) {
  const row = await PremiumPlan.findOne({
    where: { slug, is_active: true },
    attributes: ['id', 'name', 'slug', 'description', 'price', 'currency', 'duration_days', 'is_lifetime', 'features', 'is_popular', 'sort_order'],
  });
  if (!row) return null;
  const p = row.get({ plain: true });
  return { ...p, features: normalizeFeatures(p.features) };
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
    features: normalizeFeatures(p.features),
    course_ids,
    course_cat_ids,
  };
}

function slugify(text) {
  return (text || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

async function createPlan(data) {
  const slugVal = data.slug || slugify(data.name);
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
    // If marking this plan popular, clear the flag on any other plan first
    if (data.is_popular) {
      await PremiumPlan.update({ is_popular: false }, { where: { is_popular: true } });
    }
    updates.is_popular = !!data.is_popular;
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
  if (is_popular) {
    await PremiumPlan.update({ is_popular: false }, { where: { is_popular: true } });
  }
  await row.update({ is_popular: !!is_popular });
  return row.get({ plain: true });
}

async function deletePlan(id) {
  const deleted = await PremiumPlan.destroy({ where: { id } });
  return deleted > 0;
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

function extractRelatedIds(content) {
  if (typeof content !== 'string' || !content.length) return [];
  const ids = [];
  const re = /\[related\s+id="(\d+)"\]/gi;
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

  // Replace each [related id="N"] shortcode with an HTML block
  const replaced = content.replace(/\[related\s+id="(\d+)"\]/gi, (match, rawId) => {
    const n = Number(rawId);
    const article = byWpId.get(n) || byId.get(n);
    if (!article) return ''; // remove unresolvable shortcodes
    const href = `/articles/${article.slug}`;
    return `<div class="related-article-inline"><span class="related-label">Also Read:</span> <a href="${href}" class="related-link">${article.title}</a></div>`;
  });
  return replaced;
}

async function getArticleBySlugPublic(slug) {
  const row = await Article.findOne({
    where: { slug, status: 'publish' },
    attributes: [
      'id', 'title', 'slug', 'excerpt', 'content', 'thumbnail_url', 'author_id',
      'published_at', 'meta_title', 'meta_description', 'created_at', 'updated_at',
      'rel_download_url', 'upload_url',
    ],
  });
  if (!row) return null;
  const p = row.get({ plain: true });
  const authorName = await getAuthorDisplayName(p.author_id);
  const body = await embedRelatedArticles(p.content);
  const out = {
    ...p,
    body,
    cover_image_url: p.thumbnail_url,
    author_name: authorName ?? p.author_id,
    // Single download URL for "Download File" button: prefer rel_download_url, else upload_url
    download_url: p.rel_download_url || p.upload_url || null,
  };
  return out;
}

const ARTICLE_LIST_ATTRS = ['id', 'title', 'slug', 'excerpt', 'thumbnail_url', 'author_id', 'status', 'published_at', 'created_at', 'updated_at'];
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

  const result = {
    ...p,
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

// ── SEO Metadata ───────────────────────────────────────────────────

async function getSeoMetadataInternal() {
  const rows = await SeoMetadata.findAll({ order: [['id', 'DESC']] });
  return rows.map((r) => r.get({ plain: true }));
}

async function getSeoMetadataByIdInternal(id) {
  const row = await SeoMetadata.findByPk(id);
  return row ? row.get({ plain: true }) : null;
}

async function getSeoMetadataBySlugPublic(slug) {
  const row = await SeoMetadata.findOne({ where: { page_slug: slug } });
  return row ? row.get({ plain: true }) : null;
}

async function createSeoMetadata(data) {
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
  },
  articles: {
    getArticlesPublic,
    getArticleBySlugPublic,
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
