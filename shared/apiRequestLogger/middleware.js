'use strict';

const { isLoggingEnabled, shouldSkipRequest, shouldLogAtGateway } = require('./config');
const { apiRequestLogger, createRequestId } = require('./ApiRequestLogger');
const { runWithQueryContext } = require('./QueryCollector');

function captureResponseBody(res) {
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function jsonCapture(body) {
    res.locals._apiRequestLogResponseBody = body;
    return originalJson(body);
  };

  res.send = function sendCapture(body) {
    if (body !== undefined) res.locals._apiRequestLogResponseBody = body;
    return originalSend(body);
  };
}

function createApiRequestLoggerMiddleware(options = {}) {
  const role = options.role || 'service';

  return function apiRequestLoggerMiddleware(req, res, next) {
    if (!isLoggingEnabled()) return next();
    if (shouldSkipRequest(req)) return next();

    if (role === 'gateway' && !shouldLogAtGateway(req)) return next();

    const requestId = createRequestId(req);
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);

    const startedAt = Date.now();
    captureResponseBody(res);

    const finalize = () => {
      if (res.locals._apiRequestLogPersisted) return;
      res.locals._apiRequestLogPersisted = true;

      const context = {
        requestId,
        startedAt,
        responseBody: res.locals._apiRequestLogResponseBody,
        exception: req._apiLogException || null,
      };

      const entry = apiRequestLogger.buildEntry(req, res, context);
      apiRequestLogger.persistAsync(entry);
    };

    res.on('finish', finalize);
    res.on('close', finalize);

    runWithQueryContext(() => next());
  };
}

function createGatewayRequestContextMiddleware() {
  return function gatewayRequestContext(req, res, next) {
    if (!isLoggingEnabled()) return next();

    const requestId = createRequestId(req);
    req.headers['x-request-id'] = requestId;
    res.setHeader('X-Request-Id', requestId);

    const host = req.get('host') || req.headers.host || 'localhost';
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    req.headers['x-original-url'] = `${protocol}://${host}${req.originalUrl || req.url || '/'}`;

    next();
  };
}

function markGatewayOnlyLog(req) {
  req.apiRequestLogGatewayOnly = true;
}

module.exports = {
  createApiRequestLoggerMiddleware,
  createGatewayRequestContextMiddleware,
  markGatewayOnlyLog,
};
