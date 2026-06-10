const { Op } = require('sequelize');
const { Role, User } = require('../models');
const {
  requireDynamicRoleSchema,
  roleQueryAttributes,
  isDynamicRoleSchemaReady,
} = require('./rolesSchema');
const {
  ALL_PERMISSIONS,
  MODULE_HIERARCHY,
  ROLE_PERMISSIONS,
  expandPermissionHierarchy,
  getEffectivePermissions,
  parseRolePermissions,
} = require('../config/permissions');
const { AppError } = require('../../../../shared');

const PROTECTED_ROLE_NAMES = new Set(['super_admin', 'user']);

function normalizeRoleName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function sanitizePermissions(arr) {
  if (!Array.isArray(arr)) return [];
  const set = new Set(ALL_PERMISSIONS);
  return expandPermissionHierarchy(arr.filter((p) => typeof p === 'string' && set.has(p)));
}

function roleToDto(role, userCount = 0) {
  const plain = role.get ? role.get({ plain: true }) : role;
  const raw = Array.isArray(plain.permissions) ? plain.permissions : [];
  const permissions = sanitizePermissions(raw);
  return {
    id: plain.id,
    name: plain.name,
    description: plain.description || '',
    permissions,
    is_system: !!plain.is_system,
    is_admin_panel: !!plain.is_admin_panel,
    user_count: userCount,
  };
}

async function countUsersByRoleIds(roleIds) {
  if (!roleIds.length) return new Map();
  const rows = await User.findAll({
    where: { role_id: { [Op.in]: roleIds } },
    attributes: ['role_id'],
    raw: true,
  });
  const counts = new Map();
  for (const row of rows) {
    const id = row.role_id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function getPermissionsCatalog() {
  return {
    permissions: ALL_PERMISSIONS,
    moduleHierarchy: MODULE_HIERARCHY,
  };
}

async function listRoles({ adminPanelOnly = false } = {}) {
  requireDynamicRoleSchema();
  const where = adminPanelOnly ? { is_admin_panel: true } : {};
  const roles = await Role.findAll({
    where,
    order: [
      ['is_system', 'DESC'],
      ['name', 'ASC'],
    ],
    attributes: roleQueryAttributes(),
  });
  const counts = await countUsersByRoleIds(roles.map((r) => r.id));
  return roles.map((r) => roleToDto(r, counts.get(r.id) ?? 0));
}

async function getRole(id) {
  requireDynamicRoleSchema();
  const role = await Role.findByPk(id, { attributes: roleQueryAttributes() });
  if (!role) return null;
  const counts = await countUsersByRoleIds([role.id]);
  return roleToDto(role, counts.get(role.id) ?? 0);
}

async function createRole({ name, description, permissions, is_admin_panel = true }) {
  requireDynamicRoleSchema();
  const normalized = normalizeRoleName(name);
  if (!normalized) throw new AppError('Role name is required', 400);
  if (normalized === 'user' || normalized === 'super_admin') {
    throw new AppError('Cannot create a role with this reserved name', 400);
  }

  const existing = await Role.findOne({ where: { name: normalized } });
  if (existing) throw new AppError('A role with this name already exists', 409);

  const perms = sanitizePermissions(permissions);
  if (is_admin_panel && !perms.includes('admin:access')) {
    throw new AppError('Admin panel roles must include admin:access', 400);
  }
  if (is_admin_panel && perms.length === 0) {
    throw new AppError('Select at least one permission for this role', 400);
  }

  const role = await Role.create({
    name: normalized,
    description: description ? String(description).trim() : null,
    permissions: perms,
    is_system: false,
    is_admin_panel: !!is_admin_panel,
  });
  return roleToDto(role, 0);
}

async function updateRole(id, { name, description, permissions, is_admin_panel }) {
  requireDynamicRoleSchema();
  const role = await Role.findByPk(id, { attributes: roleQueryAttributes() });
  if (!role) return null;

  if (role.name === 'super_admin') {
    throw new AppError('super_admin permissions cannot be edited', 400);
  }
  if (role.name === 'user') {
    throw new AppError('The user role cannot be modified', 400);
  }

  const updates = {};

  if (name !== undefined && !role.is_system) {
    const normalized = normalizeRoleName(name);
    if (!normalized) throw new AppError('Role name is required', 400);
    if (PROTECTED_ROLE_NAMES.has(normalized)) {
      throw new AppError('Cannot rename to a reserved role name', 400);
    }
    const clash = await Role.findOne({ where: { name: normalized, id: { [Op.ne]: id } } });
    if (clash) throw new AppError('A role with this name already exists', 409);
    updates.name = normalized;
  }

  if (description !== undefined) {
    updates.description = description ? String(description).trim() : null;
  }

  if (permissions !== undefined) {
    const perms = sanitizePermissions(permissions);
    const panel = is_admin_panel !== undefined ? !!is_admin_panel : !!role.is_admin_panel;
    if (panel && !perms.includes('admin:access')) {
      throw new AppError('Admin panel roles must include admin:access', 400);
    }
    if (panel && perms.length === 0) {
      throw new AppError('Select at least one permission for this role', 400);
    }
    updates.permissions = perms;
  }

  if (is_admin_panel !== undefined) {
    updates.is_admin_panel = !!is_admin_panel;
    if (updates.is_admin_panel && updates.permissions === undefined) {
      const current = Array.isArray(role.permissions) ? role.permissions : [];
      if (!current.includes('admin:access')) {
        throw new AppError('Admin panel roles must include admin:access', 400);
      }
    }
  }

  await role.update(updates);
  const counts = await countUsersByRoleIds([role.id]);
  return roleToDto(role, counts.get(role.id) ?? 0);
}

async function deleteRole(id) {
  requireDynamicRoleSchema();
  const role = await Role.findByPk(id, { attributes: roleQueryAttributes() });
  if (!role) return false;

  if (role.is_system || PROTECTED_ROLE_NAMES.has(role.name)) {
    throw new AppError('System roles cannot be deleted', 400);
  }

  const userCount = await User.count({ where: { role_id: role.id } });
  if (userCount > 0) {
    throw new AppError(`Cannot delete role: ${userCount} user(s) still assigned`, 400);
  }

  await role.destroy();
  return true;
}

/** Seed roles.permissions from ROLE_PERMISSIONS when column exists but is empty. */
async function seedRolePermissionsIfMissing() {
  if (!isDynamicRoleSchemaReady()) return;
  const panelRoles = new Set(['super_admin', 'admin', 'editor', 'viewer', 'editor_articles', 'custom']);
  /** super_admin DB row kept in sync for display; runtime always uses ALL_PERMISSIONS. */
  const alwaysSyncPermissions = new Set(['super_admin']);

  for (const [name, templatePerms] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await Role.findOne({
      where: { name },
      attributes: roleQueryAttributes(),
    });
    if (!role) continue;

    const updates = {};
    const current = parseRolePermissions(role);
    if (
      alwaysSyncPermissions.has(name)
      && Array.isArray(templatePerms)
      && templatePerms.length > 0
    ) {
      updates.permissions = sanitizePermissions(templatePerms);
    } else if ((!current || current.length === 0) && Array.isArray(templatePerms) && templatePerms.length > 0) {
      updates.permissions = sanitizePermissions(templatePerms);
    }
    if (role.is_system == null || role.is_system === false) {
      if (name === 'user' || name === 'super_admin' || name === 'admin' || ROLE_PERMISSIONS[name]) {
        updates.is_system = ['user', 'super_admin', 'admin', 'editor', 'viewer', 'editor_articles', 'custom'].includes(name);
      }
    }
    if (panelRoles.has(name) && !role.is_admin_panel) {
      updates.is_admin_panel = true;
    }
    if (name === 'user' && role.is_admin_panel) {
      updates.is_admin_panel = false;
    }

    if (Object.keys(updates).length > 0) {
      await role.update(updates);
    }
  }
}

function effectivePermissionsForUser(roleName, rolePermissions, userOverrides) {
  return getEffectivePermissions(roleName, userOverrides, rolePermissions);
}

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getPermissionsCatalog,
  seedRolePermissionsIfMissing,
  sanitizePermissions,
  effectivePermissionsForUser,
  normalizeRoleName,
};
