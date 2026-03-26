const bcrypt = require('bcryptjs');
const { User, Role } = require('../models');
const { Op } = require('sequelize');
const { getEffectivePermissions, expandPermissionHierarchy } = require('../config/permissions');

const ADMIN_PANEL_ROLES = ['super_admin', 'admin', 'editor', 'viewer', 'editor_articles', 'custom'];

async function listRoles() {
  const roles = await Role.findAll({
    order: [['id', 'ASC']],
    attributes: ['id', 'name'],
  });
  return roles.map((r) => ({ id: r.id, name: r.name }));
}

async function createRole({ name }) {
  const role = await Role.create({ name });
  return { id: role.id, name: role.name };
}

async function listAdminUsers() {
  const roles = await Role.findAll({
    where: { name: { [Op.in]: ADMIN_PANEL_ROLES } },
    attributes: ['id'],
  });
  const roleIds = roles.map((r) => r.id);
  const users = await User.findAll({
    where: { role_id: { [Op.in]: roleIds } },
    include: [{ model: Role, as: 'Role', attributes: ['id', 'name'] }],
    attributes: ['id', 'email', 'name', 'role_id', 'is_active'],
    order: [['id', 'ASC']],
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
    include: [{ model: Role, as: 'Role', attributes: ['id', 'name'] }],
    attributes: ['id', 'email', 'name', 'role_id', 'is_active', 'permission_overrides'],
  });
  if (!user) return null;
  const plain = user.get({ plain: true });
  const roleName = plain.Role?.name || '';
  const overrides = Array.isArray(plain.permission_overrides) ? plain.permission_overrides : [];
  const permissions = getEffectivePermissions(roleName, overrides);
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

async function createAdminUser({ email, password, name, role_id, permission_overrides, actorRole }) {
  const role = await Role.findByPk(role_id);
  if (!role) throw new Error('Invalid role_id');
  if (!ADMIN_PANEL_ROLES.includes(role.name)) {
    throw new Error('Role must be one of: ' + ADMIN_PANEL_ROLES.join(', '));
  }
  if (['admin', 'super_admin'].includes(role.name) && actorRole !== 'super_admin') {
    throw new Error('Only super_admin can create admin or super_admin users');
  }
  const overrides = Array.isArray(permission_overrides) ? permission_overrides : [];
  if (role.name !== 'super_admin' && overrides.length === 0) {
    throw new Error('Select at least one permission to grant to this user');
  }
  if (role.name !== 'super_admin' && !overrides.includes('admin:access')) {
    throw new Error('Permission "admin:access" is required so the user can open the admin panel');
  }
  const expanded = expandPermissionHierarchy(overrides);
  const password_hash = await bcrypt.hash(password, 10);
  const user = await User.scope('withPassword').create({
    email,
    password_hash,
    name: name || null,
    role_id,
    is_active: true,
    permission_overrides: expanded,
  });
  return getAdminUser(user.id);
}

async function updateAdminUser(id, { name, role_id, is_active, password, permission_overrides, actorRole }) {
  const user = await User.findByPk(id);
  if (!user) return null;
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (role_id !== undefined) {
    const role = await Role.findByPk(role_id);
    if (!role) throw new Error('Invalid role_id');
    if (!ADMIN_PANEL_ROLES.includes(role.name)) {
      throw new Error('Role must be one of: ' + ADMIN_PANEL_ROLES.join(', '));
    }
    if (['admin', 'super_admin'].includes(role.name) && actorRole !== 'super_admin') {
      throw new Error('Only super_admin can assign admin or super_admin role');
    }
    updates.role_id = role_id;
  }
  if (is_active !== undefined) updates.is_active = !!is_active;
  if (password !== undefined && password !== '') {
    updates.password_hash = await bcrypt.hash(password, 10);
  }
  if (permission_overrides !== undefined) {
    const list = Array.isArray(permission_overrides) ? permission_overrides : [];
    updates.permission_overrides = expandPermissionHierarchy(list);
  }
  await user.update(updates);
  return getAdminUser(id);
}

async function deleteAdminUser(id) {
  const user = await User.findByPk(id);
  if (!user) return false;
  await user.destroy();
  return true;
}

module.exports = {
  listRoles,
  listAdminUsers,
  getAdminUser,
  createAdminUser,
  updateAdminUser,
  deleteAdminUser,
  createRole,
};
