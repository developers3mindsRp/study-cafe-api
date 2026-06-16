const usersService = require('../services/users.service');
const userExportJobService = require('../services/userExportJob.service');
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

const exportCsv = asyncHandler(async (req, res) => {
  await usersService.exportCsvStream(req.query, res);
});

const startExportJob = asyncHandler(async (req, res) => {
  const data = await userExportJobService.startExportJob(req.query);
  sendSuccess(res, data, 202);
});

const getExportJobStatus = asyncHandler(async (req, res) => {
  const status = userExportJobService.getExportJobStatus(req.params.jobId);
  if (!status) throw new AppError('Export job not found', 404);
  sendSuccess(res, status);
});

const downloadExportJob = asyncHandler(async (req, res) => {
  const filename = typeof req.query.filename === 'string' ? req.query.filename : undefined;
  const downloadToken = typeof req.query.token === 'string' ? req.query.token : undefined;
  await userExportJobService.downloadExportJob(req.params.jobId, res, filename, downloadToken);
});

module.exports = {
  ...controller,
  restore,
  listByIds,
  distinctStates,
  countUsers,
  exportCsv,
  startExportJob,
  getExportJobStatus,
  downloadExportJob,
};
