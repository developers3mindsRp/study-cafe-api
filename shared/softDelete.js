const { Op } = require('sequelize');

/** SQL fragment: row is not soft-deleted (for raw queries). */
function sqlDeletedAtIsNull(alias) {
  if (alias) return `${alias}.deleted_at IS NULL`;
  return 'deleted_at IS NULL';
}

/** Sequelize where clause for active (non-trashed) rows. */
function activeRowWhere() {
  return { deleted_at: null };
}

/** Parse ?trashed=1 from list queries. */
function parseTrashedMode(query = {}) {
  const v = query.trashed ?? query.trash;
  if (v === '1' || v === 'true' || v === 'only') return 'only';
  return 'active';
}

/** Sequelize find options: include soft-deleted rows when listing trash. */
function trashedSequelizeOptions(mode) {
  if (mode === 'only') return { paranoid: false };
  return {};
}

/** Merge trash filter into a Sequelize where clause. */
function withTrashedWhere(baseWhere, mode) {
  if (mode !== 'only') return baseWhere || {};
  const trashedClause = { deleted_at: { [Op.ne]: null } };
  if (!baseWhere || Object.keys(baseWhere).length === 0) return trashedClause;
  return { [Op.and]: [baseWhere, trashedClause] };
}

module.exports = {
  sqlDeletedAtIsNull,
  activeRowWhere,
  parseTrashedMode,
  trashedSequelizeOptions,
  withTrashedWhere,
};
