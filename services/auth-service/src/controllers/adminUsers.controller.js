const adminUsersService = require('../services/adminUsers.service');
const { ALL_PERMISSIONS } = require('../config/permissions');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent } = require('../../../../shared');

function sanitizePermissionOverrides(arr) {
  if (!Array.isArray(arr)) return [];
  const set = new Set(ALL_PERMISSIONS);
  return arr.filter((p) => typeof p === 'string' && set.has(p));
}

const listRoles = asyncHandler(async (req, res) => {
  const roles = await adminUsersService.listRoles();
  sendSuccess(res, roles);
});
const createRole = asyncHandler(async (req, res) => {
  const { name } = req.body;
  const role = await adminUsersService.createRole({ name });
  if (!role) throw new AppError('Failed to create role', 500);
  sendCreated(res, role);
});

const list = asyncHandler(async (req, res) => {
  const users = await adminUsersService.listAdminUsers();
  sendSuccess(res, users);
});

const getOne = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  const user = await adminUsersService.getAdminUser(id);
  if (!user) throw new AppError('User not found', 404);
  sendSuccess(res, user);
});

const create = asyncHandler(async (req, res) => {
  const { email, password, name, role_id, permission_overrides } = req.body;
  const user = await adminUsersService.createAdminUser({
    email: String(email).trim(),
    password,
    name: name ? String(name).trim() : null,
    role_id: parseInt(role_id, 10),
    permission_overrides: sanitizePermissionOverrides(permission_overrides),
    actorRole: req.adminUser?.role,
  });
  sendCreated(res, user);
});

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  const { name, role_id, is_active, password, permission_overrides } = req.body;
  const user = await adminUsersService.updateAdminUser(id, {
    name: name !== undefined ? (name ? String(name).trim() : null) : undefined,
    role_id: role_id !== undefined ? parseInt(role_id, 10) : undefined,
    is_active,
    password: password !== undefined ? password : undefined,
    permission_overrides: permission_overrides !== undefined ? sanitizePermissionOverrides(permission_overrides) : undefined,
    actorRole: req.adminUser?.role,
  });
  if (!user) throw new AppError('User not found', 404);
  sendSuccess(res, user);
});

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  if (req.adminUser && req.adminUser.id === id) {
    throw new AppError('You cannot delete your own account', 400);
  }
  const deleted = await adminUsersService.deleteAdminUser(id);
  if (!deleted) throw new AppError('User not found', 404);
  sendNoContent(res);
});

module.exports = { listRoles, list, getOne, create, update, remove, createRole };
