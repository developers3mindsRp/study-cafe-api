const categoriesService = require('../services/categories.service');
const { asyncHandler, sendSuccess, sendCreated, sendNoContent, sendPaginated } = require('../../../../shared');

const list = asyncHandler(async (req, res) => {
  const data = await categoriesService.list();
  sendSuccess(res, data);
});

const listAdmin = asyncHandler(async (req, res) => {
  const { page, limit, search, sortBy, sortOrder } = req.query;
  const result = await categoriesService.listPaginated({ page, limit, search, sortBy, sortOrder });
  sendPaginated(res, result);
});

const create = asyncHandler(async (req, res) => {
  const cat = await categoriesService.create(req.body);
  sendCreated(res, cat);
});

const update = asyncHandler(async (req, res) => {
  const cat = await categoriesService.update(Number(req.params.id), req.body);
  sendSuccess(res, cat);
});

const remove = asyncHandler(async (req, res) => {
  await categoriesService.remove(Number(req.params.id));
  sendNoContent(res);
});

const listFiles = asyncHandler(async (req, res) => {
  const { slug } = req.params;
  const { page, limit, search } = req.query;
  const result = await categoriesService.listFilesBySlug(slug, { page, limit, search });
  res.json({ success: true, ...result });
});

module.exports = { list, listAdmin, create, update, remove, listFiles };
