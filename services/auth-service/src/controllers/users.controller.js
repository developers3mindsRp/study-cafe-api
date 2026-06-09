const usersService = require('../services/users.service');
const { createCrudController, asyncHandler, sendSuccess, sendNoContent, AppError } = require('../../../../shared');

const controller = createCrudController(usersService, { resourceName: 'User' });

const restore = asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) throw new AppError('Invalid id', 400);
  const ok = await usersService.restore(id);
  if (!ok) throw new AppError('User not found in trash', 404);
  sendNoContent(res);
});

const listByIds = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const users = await usersService.listByIds(ids);
  sendSuccess(res, users);
});

const distinctStates = asyncHandler(async (req, res) => {
  const states = await usersService.distinctStates();
  sendSuccess(res, states);
});

const countUsers = asyncHandler(async (req, res) => {
  const data = await usersService.count();
  sendSuccess(res, data);
});

module.exports = { ...controller, listByIds, distinctStates, countUsers };
