const filesService = require('../services/files.service');
const { asyncHandler, sendSuccess, sendCreated, sendNoContent, sendPaginated, logger } = require('../../../../shared');

const list = asyncHandler(async (req, res) => {
  const { page, limit, search, category, sort } = req.query;
  const result = await filesService.list({ page, limit, search, category, sort });
  sendPaginated(res, result);
});

const listAdmin = asyncHandler(async (req, res) => {
  const { page, limit, search, category, sort, sortBy, sortOrder } = req.query;
  // Admin panel sends category_id (numeric); public list uses category (slug or id).
  const resolvedCategory = req.query.category_id || category;
  const result = await filesService.listAdmin({ page, limit, search, category: resolvedCategory, sort, sortBy, sortOrder });
  sendPaginated(res, result);
});

const getOne = asyncHandler(async (req, res) => {
  const file = await filesService.getByIdOrSlug(req.params.idOrSlug);
  sendSuccess(res, file);
});

const recordView = asyncHandler(async (req, res) => {
  const data = await filesService.incrementViewCount(req.params.idOrSlug);
  sendSuccess(res, data);
});

/**
 * Returns the protected `file_url` for a file. Caller must pass through the
 * `requireActiveMembership` middleware first — this handler trusts that
 * `req.user` and `req.membership.active === true`.
 */
const getDownloadUrl = asyncHandler(async (req, res) => {
  const data = await filesService.getSecureDownloadUrl(req.params.idOrSlug);
  const userId = req.user?.userId ?? req.user?.id;
  logger.info(
    `[downloads] member ${userId} requested file ${data.id} (${data.slug || ''}) — issuing url`
  );
  sendSuccess(res, data);
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

module.exports = { list, listAdmin, getOne, recordView, getDownloadUrl, create, update, remove };
