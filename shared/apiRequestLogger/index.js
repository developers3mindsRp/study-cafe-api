'use strict';

const {
  getConfig,
  isLoggingEnabled,
  isQueryLoggingEnabled,
  shouldSkipRequest,
  shouldLogAtGateway,
} = require('./config');
const { ApiRequestLogger, apiRequestLogger, createRequestId } = require('./ApiRequestLogger');
const createApiRequestLogModel = require('./ApiRequestLog');
const { getSequelize, getApiRequestLogModel } = require('./db');
const {
  sanitizeHeaders,
  sanitizeQueryParams,
  serializeBody,
  truncatePayload,
  safeStringify,
  isSensitiveKey,
  MASK,
} = require('./LogSanitizer');
const {
  attachQueryCollector,
  getCollectedQueries,
  runWithQueryContext,
} = require('./QueryCollector');
const {
  createApiRequestLoggerMiddleware,
  createGatewayRequestContextMiddleware,
  markGatewayOnlyLog,
} = require('./middleware');

module.exports = {
  ApiRequestLogger,
  apiRequestLogger,
  ApiRequestLog: createApiRequestLogModel,
  getSequelize,
  getApiRequestLogModel,
  getConfig,
  isLoggingEnabled,
  isQueryLoggingEnabled,
  shouldSkipRequest,
  shouldLogAtGateway,
  LogSanitizer: {
    sanitizeHeaders,
    sanitizeQueryParams,
    serializeBody,
    truncatePayload,
    safeStringify,
    isSensitiveKey,
    MASK,
  },
  QueryCollector: {
    attachQueryCollector,
    getCollectedQueries,
    runWithQueryContext,
  },
  createRequestId,
  createApiRequestLoggerMiddleware,
  createGatewayRequestContextMiddleware,
  markGatewayOnlyLog,
  attachQueryCollector,
  getCollectedQueries,
  runWithQueryContext,
};
