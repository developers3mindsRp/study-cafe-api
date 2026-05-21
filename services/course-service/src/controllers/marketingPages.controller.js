const marketingPagesService = require('../services/marketingPages.service');
const coursesService = require('../services/courses.service');
const { asyncHandler, AppError, sendSuccess, sendCreated } = require('../../../../shared');

const getPublicBySlug = asyncHandler(async (req, res) => {
  const data = await marketingPagesService.getPublicBySlug(req.params.slug);
  if (!data) throw new AppError('Marketing page not found', 404);
  sendSuccess(res, data);
});

const getPublicPageSettings = asyncHandler(async (req, res) => {
  const settings = await coursesService.getAllPageSettings();
  const safeJsonParse = (str, fallback = []) => {
    if (!str) return fallback;
    try {
      const p = JSON.parse(str);
      return Array.isArray(p) ? p : fallback;
    } catch {
      return fallback;
    }
  };
  sendSuccess(res, {
    alumni_logos: safeJsonParse(settings.alumni_logos, []),
    featured_in_logos: safeJsonParse(settings.featured_in_logos, []),
  });
});

const listInternal = asyncHandler(async (req, res) => {
  const rows = await marketingPagesService.listInternal();
  sendSuccess(res, rows);
});

const getByIdInternal = asyncHandler(async (req, res) => {
  const row = await marketingPagesService.getByIdInternal(req.params.id);
  if (!row) throw new AppError('Marketing page not found', 404);
  sendSuccess(res, row);
});

const createInternal = asyncHandler(async (req, res) => {
  const row = await marketingPagesService.create(req.body);
  sendCreated(res, row);
});

const updateInternal = asyncHandler(async (req, res) => {
  const row = await marketingPagesService.update(req.params.id, req.body);
  if (!row) throw new AppError('Marketing page not found', 404);
  sendSuccess(res, row);
});

const deleteInternal = asyncHandler(async (req, res) => {
  const ok = await marketingPagesService.delete(req.params.id);
  if (!ok) throw new AppError('Marketing page not found', 404);
  sendSuccess(res, { deleted: true });
});

module.exports = {
  getPublicBySlug,
  getPublicPageSettings,
  listInternal,
  getByIdInternal,
  createInternal,
  updateInternal,
  deleteInternal,
};
