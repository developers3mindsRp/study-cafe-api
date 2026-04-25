const { QueryTypes, Op } = require('sequelize');
const { FileCat, File, FileCategory, sequelize } = require('../models');
const { AppError, paginate } = require('../../../../shared');
const { slugify } = require('../utils/slugify');
const { PUBLIC_FILE_ATTRS } = require('./files.service');

const categoriesService = {
  async list() {
    const rows = await sequelize.query(
      `SELECT fc.id, fc.wp_term_id, fc.name, fc.slug,
              (SELECT COUNT(*) FROM file_categories x
               INNER JOIN files f ON f.id = x.file_id AND f.status = 'publish'
               WHERE x.file_cat_id = fc.id) AS file_count
       FROM file_cats fc
       ORDER BY fc.name ASC`,
      { type: QueryTypes.SELECT }
    );
    return rows.map((r) => ({
      id: r.id,
      wp_term_id: r.wp_term_id,
      name: r.name,
      slug: r.slug,
      file_count: Number(r.file_count) || 0,
    }));
  },

  /**
   * Admin paginated list — supports page, limit, search, sort.
   */
  async listPaginated({ page = 1, limit = 20, search, sortBy, sortOrder } = {}) {
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (safePage - 1) * safeLimit;

    let searchClause = '';
    const replacements = { limit: safeLimit, offset };

    if (search && search.trim()) {
      searchClause = `AND (fc.name LIKE :search OR fc.slug LIKE :search)`;
      replacements.search = `%${search.trim()}%`;
    }

    const allowedSort = { name: 'fc.name', slug: 'fc.slug', file_count: 'file_count' };
    const orderCol = allowedSort[sortBy] || 'fc.name';
    const orderDir = sortOrder === 'DESC' ? 'DESC' : 'ASC';

    const rows = await sequelize.query(
      `SELECT fc.id, fc.wp_term_id, fc.name, fc.slug,
              (SELECT COUNT(*) FROM file_categories x
               INNER JOIN files f ON f.id = x.file_id AND f.status = 'publish'
               WHERE x.file_cat_id = fc.id) AS file_count
       FROM file_cats fc
       WHERE 1=1 ${searchClause}
       ORDER BY ${orderCol} ${orderDir}
       LIMIT :limit OFFSET :offset`,
      { type: QueryTypes.SELECT, replacements }
    );

    const [countRow] = await sequelize.query(
      `SELECT COUNT(*) AS total FROM file_cats fc WHERE 1=1 ${searchClause}`,
      { type: QueryTypes.SELECT, replacements }
    );

    const total = Number(countRow.total) || 0;
    const totalPages = Math.ceil(total / safeLimit) || 0;

    return {
      data: rows.map((r) => ({
        id: r.id,
        wp_term_id: r.wp_term_id,
        name: r.name,
        slug: r.slug,
        file_count: Number(r.file_count) || 0,
      })),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  },

  async listFilesBySlug(slug, { page = 1, limit = 10, search } = {}) {
    const cat = await FileCat.findOne({ where: { slug } });
    if (!cat) throw new AppError('Category not found', 404);

    const where = { status: 'publish' };
    if (search && String(search).trim()) {
      where.title = { [Op.like]: `%${String(search).trim()}%` };
    }

    const result = await paginate(File, {
      page,
      limit,
      where,
      attributes: PUBLIC_FILE_ATTRS,
      include: [
        {
          model: FileCat,
          through: { attributes: [] },
          where: { id: cat.id },
          required: true,
        },
      ],
      sortBy: 'created_at',
      sortOrder: 'DESC',
    });

    return result;
  },

  async getById(id) {
    const cat = await FileCat.findByPk(id);
    if (!cat) throw new AppError('Category not found', 404);
    return cat.get({ plain: true });
  },

  async create({ name, slug: slugInput, wp_term_id }) {
    const slug = slugInput && slugInput.trim() ? slugInput.trim() : slugify(name);

    const cat = await FileCat.create({ name, slug, wp_term_id: wp_term_id || null });
    return cat.get({ plain: true });
  },

  async update(id, { name, slug: slugInput, wp_term_id }) {
    const cat = await FileCat.findByPk(id);
    if (!cat) throw new AppError('Category not found', 404);

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (slugInput !== undefined) {
      updates.slug = slugInput && slugInput.trim() ? slugInput.trim() : slugify(name || cat.name);
    }
    if (wp_term_id !== undefined) updates.wp_term_id = wp_term_id;

    await cat.update(updates);
    return cat.get({ plain: true });
  },

  async remove(id) {
    const cat = await FileCat.findByPk(id);
    if (!cat) throw new AppError('Category not found', 404);

    await FileCategory.destroy({ where: { file_cat_id: id } });
    await cat.destroy();
  },
};

module.exports = categoriesService;
