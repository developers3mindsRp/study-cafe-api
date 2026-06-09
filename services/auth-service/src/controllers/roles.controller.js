const rolesService = require('../services/roles.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent } = require('../../../../shared');

const list = asyncHandler(async (req, res) => {
  const adminPanelOnly = req.query.admin_panel === '1' || req.query.admin_panel === 'true';
  const roles = await rolesService.listRoles({ adminPanelOnly });
  sendSuccess(res, roles);
});

const getOne = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  const role = await rolesService.getRole(id);
  if (!role) throw new AppError('Role not found', 404);
  sendSuccess(res, role);
});

const create = asyncHandler(async (req, res) => {
  const { name, description, permissions, is_admin_panel } = req.body;
  const role = await rolesService.createRole({
    name,
    description,
    permissions,
    is_admin_panel,
  });
  sendCreated(res, role);
});

const update = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  const { name, description, permissions, is_admin_panel } = req.body;
  const role = await rolesService.updateRole(id, { name, description, permissions, is_admin_panel });
  if (!role) throw new AppError('Role not found', 404);
  sendSuccess(res, role);
});

const remove = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  const deleted = await rolesService.deleteRole(id);
  if (!deleted) throw new AppError('Role not found', 404);
  sendNoContent(res);
});

const catalog = asyncHandler(async (req, res) => {
  sendSuccess(res, rolesService.getPermissionsCatalog());
});

module.exports = { list, getOne, create, update, remove, catalog };
