const filesService = require('../services/files.service');
const { asyncHandler, sendSuccess, sendCreated, sendNoContent, sendPaginated } = require('../../../../shared');

const list = asyncHandler(async (req, res) => {
  const { page, limit, search, category, sort } = req.query;
  const result = await filesService.list({ page, limit, search, category, sort });
  sendPaginated(res, result);
});

const listAdmin = asyncHandler(async (req, res) => {
  const { page, limit, search, category, sort, sortBy, sortOrder } = req.query;
  const result = await filesService.listAdmin({ page, limit, search, category, sort, sortBy, sortOrder });
  sendPaginated(res, result);
});

const getOne = asyncHandler(async (req, res) => {
  const file = await filesService.getByIdOrSlug(req.params.idOrSlug);
  sendSuccess(res, file);
});

const create = asyncHandler(async (req, res) => {
  const file = await filesService.create(req.body);
  sendCreated(res, file);
});

const update = asyncHandler(async (req, res) => {
  const file = await filesService.update(Number(req.params.id), req.body);
  sendSuccess(res, file);
});

const remove = asyncHandler(async (req, res) => {
  await filesService.remove(Number(req.params.id));
  sendNoContent(res);
});

module.exports = { list, listAdmin, getOne, create, update, remove };
