/**
 * Shared Utilities — Single entry point.
 *
 * Usage from any service:
 *   const { logger, AppError, asyncHandler, errorHandler, validate, sendSuccess, ... } = require('../../shared');
 */

const { logger } = require('./logger');
const { AppError } = require('./AppError');
const { asyncHandler } = require('./asyncHandler');
const { errorHandler } = require('./errorHandler');
const { createCrudController } = require('./baseController');
const { paginate } = require('./pagination/paginate');
const { validate } = require('./validate');
const { sendSuccess, sendCreated, sendNoContent, sendPaginated } = require('./responseHelper');
const {
    getYearMonthParts,
    relativePathFromFile,
    publicMediaUrl,
} = require('./mediaUrl');
const { computeMembershipUpgradeCredit } = require('./membershipUpgradeProration');
const {
  sqlDeletedAtIsNull,
  activeRowWhere,
  parseTrashedMode,
  trashedSequelizeOptions,
  withTrashedWhere,
  whereHasClauses,
} = require('./softDelete');

module.exports = {
    logger,
    AppError,
    asyncHandler,
    errorHandler,
    createCrudController,
    paginate,
    validate,
    sendSuccess,
    sendCreated,
    sendNoContent,
    sendPaginated,
    getYearMonthParts,
    relativePathFromFile,
    publicMediaUrl,
    computeMembershipUpgradeCredit,
    sqlDeletedAtIsNull,
    activeRowWhere,
    parseTrashedMode,
    trashedSequelizeOptions,
    withTrashedWhere,
    whereHasClauses,
};
