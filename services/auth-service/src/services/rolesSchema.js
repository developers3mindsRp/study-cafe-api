const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');

/** Cached after first check — null until probed. */
let dynamicColumnsReady = null;

const DYNAMIC_ROLE_COLUMNS = ['description', 'permissions', 'is_system', 'is_admin_panel'];

async function probeDynamicRoleColumns() {
  if (dynamicColumnsReady !== null) return dynamicColumnsReady;
  try {
    const rows = await sequelize.query(
      `SELECT 1 AS ok FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'roles'
         AND COLUMN_NAME = 'permissions'
       LIMIT 1`,
      { type: QueryTypes.SELECT }
    );
    dynamicColumnsReady = rows.length > 0;
  } catch {
    dynamicColumnsReady = false;
  }
  if (!dynamicColumnsReady) {
    const { logger } = require('../../../../shared');
    logger.warn(
      '[roles] Dynamic role columns missing — run services/auth-service/scripts/migrate-dynamic-roles.sql. Roles API disabled until then.'
    );
  }
  return dynamicColumnsReady;
}

function isDynamicRoleSchemaReady() {
  return dynamicColumnsReady === true;
}

function roleQueryAttributes() {
  const base = ['id', 'name'];
  return isDynamicRoleSchemaReady() ? [...base, ...DYNAMIC_ROLE_COLUMNS] : base;
}

function requireDynamicRoleSchema() {
  const { AppError } = require('../../../../shared');
  if (!isDynamicRoleSchemaReady()) {
    throw new AppError(
      'Roles module is not enabled yet. Run migrate-dynamic-roles.sql on the database, then restart auth-service.',
      503
    );
  }
}

module.exports = {
  probeDynamicRoleColumns,
  isDynamicRoleSchemaReady,
  roleQueryAttributes,
  requireDynamicRoleSchema,
  DYNAMIC_ROLE_COLUMNS,
};
