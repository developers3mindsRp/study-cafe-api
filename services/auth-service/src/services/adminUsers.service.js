const bcrypt = require('bcryptjs');
const { User, Role } = require('../models');
const { Op } = require('sequelize');
const { parseRolePermissions } = require('../config/permissions');
const { effectivePermissionsForUser, sanitizePermissions } = require('./roles.service');
const { roleQueryAttributes, isDynamicRoleSchemaReady } = require('./rolesSchema');
const { AppError, logger } = require('../../../../shared');

const LEGACY_ADMIN_PANEL_ROLES = ['super_admin', 'admin', 'editor', 'viewer', 'editor_articles', 'custom'];

function roleInclude() {
  return {
    model: Role,
    as: 'Role',
    attributes: isDynamicRoleSchemaReady()
      ? ['id', 'name', 'permissions', 'is_admin_panel', 'is_system']
      : ['id', 'name'],
  };
}

function isAssignableAdminRole(role) {
  if (!role) return false;
  if (isDynamicRoleSchemaReady()) return !!role.is_admin_panel;
  return LEGACY_ADMIN_PANEL_ROLES.includes(role.name);
}

function actorMayAssignAdminRole({ actorRole, actorPermissions }) {
  if (actorRole === 'super_admin') return true;
  return Array.isArray(actorPermissions) && actorPermissions.includes('admin_users:create');
}

async function listRoles() {
  const roles = await Role.findAll({
    where: isDynamicRoleSchemaReady()
      ? { is_admin_panel: true }
      : { name: { [Op.in]: LEGACY_ADMIN_PANEL_ROLES } },
    order: isDynamicRoleSchemaReady()
      ? [
          ['is_system', 'DESC'],
          ['name', 'ASC'],
        ]
      : [['name', 'ASC']],
    attributes: roleQueryAttributes(),
  });
  if (isDynamicRoleSchemaReady()) {
    return roles.map((r) => {
        const plain = r.get({ plain: true });
        return {
          id: plain.id,
          name: plain.name,
          description: plain.description || '',
          permissions: Array.isArray(plain.permissions) ? plain.permissions : [],
          is_system: !!plain.is_system,
          is_admin_panel: !!plain.is_admin_panel,
        };
      });
  }
  return roles.map((r) => {
    const plain = r.get({ plain: true });
    return {
      id: plain.id,
      name: plain.name,
      description: plain.description || '',
      permissions: Array.isArray(plain.permissions) ? plain.permissions : [],
      is_system: !!plain.is_system,
      is_admin_panel: !!plain.is_admin_panel,
    };
  });
}

async function createRole({ name }) {
  const rolesService = require('./roles.service');
  return rolesService.createRole({ name, permissions: ['admin:access'], is_admin_panel: true });
}

async function listAdminUsers() {
  const roles = await Role.findAll({
    where: isDynamicRoleSchemaReady()
      ? { is_admin_panel: true }
      : { name: { [Op.in]: LEGACY_ADMIN_PANEL_ROLES } },
    attributes: ['id'],
  });
  const roleIds = roles.map((r) => r.id);
  if (!roleIds.length) return [];
  const users = await User.findAll({
    where: { role_id: { [Op.in]: roleIds } },
    include: [{ model: Role, as: 'Role', attributes: ['id', 'name'] }],
    attributes: ['id', 'email', 'name', 'role_id', 'is_active'],
    order: [['id', 'DESC']],
  });
  return users.map((u) => {
    const plain = u.get({ plain: true });
    const roleName = plain.Role?.name || '';
    return {
      id: plain.id,
      email: plain.email,
      name: plain.name || '',
      role_id: plain.role_id,
      role: roleName,
      is_active: !!plain.is_active,
    };
  });
}

async function getAdminUser(id) {
  const user = await User.findByPk(id, {
    include: [roleInclude()],
    attributes: ['id', 'email', 'name', 'role_id', 'is_active', 'permission_overrides'],
  });
  if (!user) return null;
  const plain = user.get({ plain: true });
  const roleName = plain.Role?.name || '';
  const overrides = Array.isArray(plain.permission_overrides) ? plain.permission_overrides : [];
  const rolePerms = parseRolePermissions(plain.Role);
  const permissions = effectivePermissionsForUser(roleName, rolePerms, overrides);
  return {
    id: plain.id,
    email: plain.email,
    name: plain.name || '',
    role_id: plain.role_id,
    role: roleName,
    is_active: !!plain.is_active,
    permissions,
    permission_overrides: overrides,
  };
}

async function lookupUserForAdminGrant(email) {
  const normEmail = String(email || '').trim().toLowerCase();
  if (!normEmail) return { exists: false };

  const user = await User.findOne({
    where: { email: normEmail },
    include: [roleInclude()],
    attributes: ['id', 'email', 'name', 'role_id', 'is_active'],
  });
  if (!user) return { exists: false };

  const plain = user.get({ plain: true });
  const roleName = plain.Role?.name || 'user';
  const isAdminPanel = isAssignableAdminRole(plain.Role);

  if (roleName === 'super_admin' || roleName === 'admin') {
    return {
      exists: true,
      id: plain.id,
      email: plain.email,
      name: plain.name || '',
      role: roleName,
      role_id: plain.role_id,
      is_admin_panel: isAdminPanel,
      can_promote: false,
      message: 'This email is already an admin user. Edit them from the admin users list instead.',
    };
  }

  return {
    exists: true,
    id: plain.id,
    email: plain.email,
    name: plain.name || '',
    role: roleName,
    role_id: plain.role_id,
    is_admin_panel: isAdminPanel,
    can_promote: true,
    message: isAdminPanel
      ? 'Existing admin account — only role and permissions will be updated. Password stays unchanged.'
      : 'Existing site user found — grant admin access without changing their password.',
  };
}

async function createAdminUser({
  email, password, name, role_id, permission_overrides, actorRole, actorPermissions,
}) {
  const role = await Role.findByPk(role_id);
  if (!role) throw new Error('Invalid role_id');
  if (!isAssignableAdminRole(role)) {
    throw new Error('Selected role cannot be assigned to admin panel users');
  }
  if (role.name === 'super_admin' && actorRole !== 'super_admin') {
    throw new Error('Only super_admin can create super_admin users');
  }
  if (role.name === 'admin' && !actorMayAssignAdminRole({ actorRole, actorPermissions })) {
    throw new Error('Insufficient permissions to assign the admin role');
  }
  const overrides = Array.isArray(permission_overrides) ? permission_overrides : [];
  const rolePerms = parseRolePermissions(role);
  const isFullAccess = role.name === 'super_admin';
  const effective = effectivePermissionsForUser(role.name, rolePerms, overrides);
  if (!isFullAccess && effective.length === 0) {
    throw new Error('Select at least one permission to grant to this user (via role or overrides)');
  }
  if (!isFullAccess && !effective.includes('admin:access')) {
    throw new Error('Permission "admin:access" is required so the user can open the admin panel');
  }
  const expanded = sanitizePermissions(overrides);

  const normEmail = String(email).trim().toLowerCase();
  const existingUser = await User.findOne({
    where: { email: normEmail },
    include: [{ model: Role, as: 'Role' }]
  });

  if (existingUser) {
    const existingRoleName = existingUser.Role?.name || 'user';
    if (existingRoleName === 'super_admin' || existingRoleName === 'admin') {
      throw new AppError('This email is already an admin user. Edit them from the admin users list instead.', 400);
    }

    const updates = {
      role_id,
      is_active: true,
      permission_overrides: expanded,
    };
    if (name) updates.name = name;
    if (password) {
      updates.password_hash = await bcrypt.hash(password, 10);
    }

    await existingUser.update(updates);
    return getAdminUser(existingUser.id);
  }

  if (!password || String(password).length < 6) {
    throw new AppError('Password is required for new users (min 6 characters)', 400);
  }

  const password_hash = await bcrypt.hash(password, 10);
  try {
    const user = await User.scope('withPassword').create({
      email,
      password_hash,
      name: name || null,
      role_id,
      is_active: true,
      permission_overrides: expanded,
    });
    return getAdminUser(user.id);
  } catch (err) {
    logger.error('[adminUsers] createAdminUser failed during user creation', {
      error: err.message,
      payload: { email, role_id },
    });
    throw err;
  }
}

async function updateAdminUser(id, {
  name, role_id, is_active, password, permission_overrides, actorRole, actorPermissions,
}) {
  const user = await User.findByPk(id);
  if (!user) return null;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (role_id !== undefined) {
    const role = await Role.findByPk(role_id);
    if (!role) throw new Error('Invalid role_id');
    if (!isAssignableAdminRole(role)) {
      throw new Error('Selected role cannot be assigned to admin panel users');
    }
    if (role.name === 'super_admin' && actorRole !== 'super_admin') {
      throw new Error('Only super_admin can assign the super_admin role');
    }
    if (role.name === 'admin' && !actorMayAssignAdminRole({ actorRole, actorPermissions })) {
      throw new Error('Insufficient permissions to assign the admin role');
    }
    updates.role_id = role_id;
  }
  if (is_active !== undefined) updates.is_active = !!is_active;
  if (password !== undefined && password !== '') {
    updates.password_hash = await bcrypt.hash(password, 10);
  }
  if (permission_overrides !== undefined) {
    const list = Array.isArray(permission_overrides) ? permission_overrides : [];
    updates.permission_overrides = sanitizePermissions(list);
  }

  if (updates.role_id !== undefined || updates.permission_overrides !== undefined) {
    const nextRole = updates.role_id !== undefined
      ? await Role.findByPk(updates.role_id)
      : await Role.findByPk(user.role_id);
    const nextOverrides = updates.permission_overrides !== undefined
      ? updates.permission_overrides
      : (Array.isArray(user.permission_overrides) ? user.permission_overrides : []);
    const roleName = nextRole?.name || '';
    const effective = effectivePermissionsForUser(roleName, parseRolePermissions(nextRole), nextOverrides);
    if (roleName !== 'super_admin' && !effective.includes('admin:access')) {
      throw new Error('Permission "admin:access" is required so the user can open the admin panel');
    }
  }
  try {
    await user.update(updates);
    return getAdminUser(id);
  } catch (err) {
    logger.error('[adminUsers] updateAdminUser failed', {
      error: err.message,
      id,
      updates: Object.keys(updates),
    });
    throw err;
  }
}

async function deleteAdminUser(id) {
  try {
    const user = await User.findByPk(id);
    if (!user) return false;
    await user.destroy();
    return true;
  } catch (err) {
    logger.error('[adminUsers] deleteAdminUser failed', { error: err.message, id });
    throw err;
  }
}

module.exports = {
  listRoles,
  listAdminUsers,
  getAdminUser,
  lookupUserForAdminGrant,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  createRole,
};
