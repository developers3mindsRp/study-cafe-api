const { Role, User } = require('../models');
const { logger } = require('../../../../shared');

const CORE_ROLES = ['user', 'admin', 'super_admin'];

/**
 * Ensures core roles exist and assigns `user` role to any account missing role_id.
 * Safe to run on every auth-service DB connect.
 */
async function ensureCoreRolesAndUserAssignments() {
  const byName = new Map();
  for (const name of CORE_ROLES) {
    const [row] = await Role.findOrCreate({
      where: { name },
      defaults: { name },
    });
    byName.set(name, row);
  }
  const userRole = byName.get('user');
  if (!userRole) return;

  const [affected] = await User.update({ role_id: userRole.id }, { where: { role_id: null } });
  if (affected > 0) {
    logger.info(`[rolesBootstrap] Assigned default "user" role to ${affected} account(s)`);
  }
}

module.exports = { ensureCoreRolesAndUserAssignments, CORE_ROLES };
