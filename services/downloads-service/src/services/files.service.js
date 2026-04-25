const { Op } = require('sequelize');
const { File, FileCat, FileCategory, sequelize } = require('../models');
const { AppError, paginate } = require('../../../../shared');
const { slugify } = require('../utils/slugify');

/**
 * Columns safe to expose to anonymous / non-member users.
 * IMPORTANT: never includes `file_url` — that is gated behind active membership
 * via `getSecureDownloadUrl()` and the protected route GET /api/downloads/files/:idOrSlug/url.
 */
const PUBLIC_FILE_ATTRS = [
  'id',
  'wp_post_id',
  'title',
  'slug',
  'author_id',
  'views',
  'status',
  'meta_title',
  'meta_description',
  'meta_keywords',
  'created_at',
];

const filesService = {
  /**
   * Admin list — shows all statuses, accepts sortBy/sortOrder from DataTable.
   */
  async listAdmin({ page = 1, limit = 20, search, category, sort, sortBy, sortOrder } = {}) {
    const where = {};

    if (search && search.trim()) {
      where.title = { [Op.like]: `%${search.trim()}%` };
    }

    // DataTable sends sortBy (field name) + sortOrder; fallback to sort=latest/trending
    let resolvedSortBy = 'created_at';
    let resolvedSortOrder = 'DESC';

    if (sortBy && sortBy.trim() && sortBy !== 'FileCats') {
      resolvedSortBy = sortBy.trim();
      resolvedSortOrder = sortOrder === 'ASC' ? 'ASC' : 'DESC';
    } else if (sort === 'trending') {
      resolvedSortBy = 'views';
    }

    const includeOptions = [
      {
        model: FileCat,
        through: { attributes: [] },
        required: false,
      },
    ];

    if (category) {
      const isNumeric = /^\d+$/.test(String(category));
      const catWhere = isNumeric ? { id: Number(category) } : { slug: String(category) };
      const cat = await FileCat.findOne({ where: catWhere });
      if (!cat) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      }
      includeOptions[0].where = { id: cat.id };
      includeOptions[0].required = true;
    }

    return paginate(File, {
      where,
      page,
      limit,
      sortBy: resolvedSortBy,
      sortOrder: resolvedSortOrder,
      include: includeOptions,
    });
  },

  async list({ page = 1, limit = 10, search, category, sort = 'latest' } = {}) {
    const where = { status: 'publish' };

    if (search && search.trim()) {
      where.title = { [Op.like]: `%${search.trim()}%` };
    }

    const sortBy = sort === 'trending' ? 'views' : 'created_at';
    const sortOrder = 'DESC';

    const includeOptions = [
      {
        model: FileCat,
        through: { attributes: [] },
        required: false,
      },
    ];

    if (category) {
      const isNumeric = /^\d+$/.test(String(category));
      const catWhere = isNumeric
        ? { id: Number(category) }
        : { slug: String(category) };

      const cat = await FileCat.findOne({ where: catWhere });
      if (!cat) {
        return { data: [], meta: { total: 0, page, limit, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      }

      includeOptions[0].where = { id: cat.id };
      includeOptions[0].required = true;
    }

    return paginate(File, {
      where,
      page,
      limit,
      sortBy,
      sortOrder,
      attributes: PUBLIC_FILE_ATTRS,
      include: includeOptions,
    });
  },

  async getByIdOrSlug(idOrSlug) {
    const isNumeric = /^\d+$/.test(String(idOrSlug));
    const where = isNumeric ? { id: Number(idOrSlug) } : { slug: String(idOrSlug) };

    const file = await File.findOne({
      where,
      attributes: PUBLIC_FILE_ATTRS,
      include: [{ model: FileCat, through: { attributes: [] } }],
    });

    if (!file) throw new AppError('File not found', 404);

    // Do not increment views here — GET runs during SSR and again on the client,
    // which causes hydration mismatches. Use incrementViewCount via POST from the browser.
    return file.get({ plain: true });
  },

  /**
   * Increment view counter once (call from client after mount).
   * @returns {{ views: number }}
   */
  async incrementViewCount(idOrSlug) {
    const isNumeric = /^\d+$/.test(String(idOrSlug));
    const where = isNumeric ? { id: Number(idOrSlug) } : { slug: String(idOrSlug) };

    const file = await File.findOne({
      where,
      attributes: ['id', 'views', 'status'],
    });
    if (!file) throw new AppError('File not found', 404);
    const plain = file.get({ plain: true });
    if (plain.status !== 'publish') throw new AppError('File not found', 404);

    await file.increment('views', { by: 1 });
    await file.reload();
    return { views: file.views ?? 0 };
  },

  /**
   * Returns the protected `file_url` for a file. Caller MUST have already
   * verified that the requester is authenticated AND has an active membership.
   * Throws 404 if the file does not exist or is not published.
   */
  async getSecureDownloadUrl(idOrSlug) {
    const isNumeric = /^\d+$/.test(String(idOrSlug));
    const where = isNumeric ? { id: Number(idOrSlug) } : { slug: String(idOrSlug) };

    const file = await File.findOne({
      where,
      attributes: ['id', 'slug', 'title', 'file_url', 'status'],
    });

    if (!file) throw new AppError('File not found', 404);
    const plain = file.get({ plain: true });
    if (plain.status !== 'publish') throw new AppError('File not found', 404);

    return {
      id: plain.id,
      slug: plain.slug,
      title: plain.title,
      url: plain.file_url,
    };
  },

  async create({ title, slug: slugInput, file_url, author_id, category_ids = [], status = 'publish', meta_title, meta_description, meta_keywords }) {
    const slug = slugInput && slugInput.trim() ? slugInput.trim() : slugify(title);

    if (category_ids.length > 0) {
      const count = await FileCat.count({ where: { id: category_ids } });
      if (count !== category_ids.length) {
        throw new AppError('One or more category IDs are invalid', 400);
      }
    }

    const result = await sequelize.transaction(async (t) => {
      const file = await File.create(
        {
          title,
          slug,
          file_url,
          author_id: author_id || null,
          status,
          meta_title: meta_title || null,
          meta_description: meta_description || null,
          meta_keywords: meta_keywords || null,
        },
        { transaction: t }
      );

      if (category_ids.length > 0) {
        const pivotRows = category_ids.map((catId) => ({
          file_id: file.id,
          file_cat_id: catId,
        }));
        await FileCategory.bulkCreate(pivotRows, { transaction: t });
      }

      return file;
    });

    return filesService.getById(result.id);
  },

  async getById(id) {
    const file = await File.findByPk(id, {
      include: [{ model: FileCat, through: { attributes: [] } }],
    });
    if (!file) throw new AppError('File not found', 404);
    return file.get({ plain: true });
  },

  async update(id, { title, slug: slugInput, file_url, author_id, category_ids, status, meta_title, meta_description, meta_keywords }) {
    const file = await File.findByPk(id);
    if (!file) throw new AppError('File not found', 404);

    if (category_ids !== undefined && category_ids.length > 0) {
      const count = await FileCat.count({ where: { id: category_ids } });
      if (count !== category_ids.length) {
        throw new AppError('One or more category IDs are invalid', 400);
      }
    }

    await sequelize.transaction(async (t) => {
      const updates = {};
      if (title !== undefined) updates.title = title;
      if (slugInput !== undefined) {
        updates.slug = slugInput && slugInput.trim() ? slugInput.trim() : slugify(title || file.title);
      }
      if (file_url !== undefined) updates.file_url = file_url;
      if (author_id !== undefined) updates.author_id = author_id;
      if (status !== undefined) updates.status = status;
      if (meta_title !== undefined) updates.meta_title = meta_title;
      if (meta_description !== undefined) updates.meta_description = meta_description;
      if (meta_keywords !== undefined) updates.meta_keywords = meta_keywords;

      if (Object.keys(updates).length > 0) {
        await file.update(updates, { transaction: t });
      }

      if (category_ids !== undefined) {
        await FileCategory.destroy({ where: { file_id: id }, transaction: t });
        if (category_ids.length > 0) {
          const pivotRows = category_ids.map((catId) => ({
            file_id: id,
            file_cat_id: catId,
          }));
          await FileCategory.bulkCreate(pivotRows, { transaction: t });
        }
      }
    });

    return filesService.getById(id);
  },

  async remove(id) {
    const file = await File.findByPk(id);
    if (!file) throw new AppError('File not found', 404);

    await sequelize.transaction(async (t) => {
      await FileCategory.destroy({ where: { file_id: id }, transaction: t });
      await file.destroy({ transaction: t });
    });
  },
};

module.exports = filesService;
module.exports.PUBLIC_FILE_ATTRS = PUBLIC_FILE_ATTRS;
