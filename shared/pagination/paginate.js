/**
 * Reusable server-side pagination utility for Sequelize.
 * Use across Articles, Users, Tasks, Notifications, and all future modules.
 *
 * @param {object} model - Sequelize model (e.g. Article, User)
 * @param {object} options
 * @param {object} [options.where] - Sequelize where clause
 * @param {number} [options.page=1] - Page number (1-based)
 * @param {number} [options.limit=10] - Items per page
 * @param {string} [options.sortBy] - Column to sort by (must be a valid attribute)
 * @param {string} [options.sortOrder='DESC'] - 'ASC' | 'DESC'
 * @param {string} [options.search] - Search term (optional; not applied by this utility - caller adds to where)
 * @param {object} [options.attributes] - Attributes to select
 * @param {object[]} [options.include] - Sequelize includes
 * @returns {Promise<{ data: any[], meta: { total, page, limit, totalPages, hasNextPage, hasPreviousPage } }>}
 */
async function paginate(model, options = {}) {
  const {
    where = {},
    page = 1,
    limit = 10,
    sortBy,
    sortOrder = 'DESC',
    attributes,
    include,
    distinct,
    col,
    subQuery,
    paranoid,
  } = options;

  const safePage = Math.max(1, parseInt(String(page), 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
  const offset = (safePage - 1) * safeLimit;

  const order = [];
  if (sortBy && typeof sortBy === 'string' && sortBy.trim()) {
    const col = sortBy.trim();
    const dir = String(sortOrder).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    order.push([col, dir]);
  }

  const findOptions = {
    where,
    limit: safeLimit,
    offset,
    order: order.length ? order : undefined,
    ...(attributes && { attributes }),
    ...(include && { include }),
    ...(typeof distinct === 'boolean' && { distinct }),
    ...(col && { col }),
    ...(typeof subQuery === 'boolean' && { subQuery }),
    ...(paranoid !== undefined && { paranoid }),
  };

  const { count, rows } = await model.findAndCountAll(findOptions);
  const total = typeof count === 'number' ? count : count.length;
  const totalPages = Math.ceil(total / safeLimit) || 0;

  const meta = {
    total,
    page: safePage,
    limit: safeLimit,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
  };

  const data = rows.map((r) => (typeof r.get === 'function' ? r.get({ plain: true }) : r));

  return { data, meta };
}

module.exports = { paginate };
