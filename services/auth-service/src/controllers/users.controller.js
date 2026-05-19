const usersService = require('../services/users.service');
const { createCrudController, asyncHandler, sendSuccess } = require('../../../../shared');

const controller = createCrudController(usersService, { resourceName: 'User' });

const listByIds = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const users = await usersService.listByIds(ids);
  sendSuccess(res, users);
});

const distinctStates = asyncHandler(async (req, res) => {
  const states = await usersService.distinctStates();
  sendSuccess(res, states);
});

module.exports = { ...controller, listByIds, distinctStates };
