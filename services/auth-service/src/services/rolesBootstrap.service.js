const { QueryTypes } = require('sequelize');
const { sequelize, User } = require('../models');
const { logger } = require('../../../../shared');
const { probeDynamicRoleColumns, isDynamicRoleSchemaReady } = require('./rolesSchema');

const CORE_ROLES = ['user', 'admin', 'super_admin'];

/**
 * Ensures core roles exist and assigns `user` role to any account missing role_id.
 * Uses raw SQL for core roles so startup succeeds before migrate-dynamic-roles.sql is applied.
 */
async function ensureCoreRolesAndUserAssignments() {
  await probeDynamicRoleColumns();

  const byName = new Map();
  for (const name of CORE_ROLES) {
    // Avoid duplicate rows when roles.name is not UNIQUE (legacy DBs).
    await sequelize.query(
      `INSERT INTO roles (name)
       SELECT :name FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = :name LIMIT 1)`,
      { replacements: { name }, type: QueryTypes.INSERT }
    );
    const rows = await sequelize.query(
      `SELECT id, name FROM roles WHERE name = :name ORDER BY id ASC LIMIT 1`,
      { replacements: { name }, type: QueryTypes.SELECT }
    );
    if (rows[0]) byName.set(name, rows[0]);
  }

  const userRole = byName.get('user');
  if (!userRole) return;

  const [affected] = await User.update({ role_id: userRole.id }, { where: { role_id: null } });
  if (affected > 0) {
    logger.info(`[rolesBootstrap] Assigned default "user" role to ${affected} account(s)`);
  }

  if (!isDynamicRoleSchemaReady()) return;

  try {
    const { seedRolePermissionsIfMissing } = require('./roles.service');
    await seedRolePermissionsIfMissing();
  } catch (err) {
    logger.warn(`[rolesBootstrap] seedRolePermissionsIfMissing skipped: ${err.message}`);
  }
}

module.exports = { ensureCoreRolesAndUserAssignments, CORE_ROLES };
