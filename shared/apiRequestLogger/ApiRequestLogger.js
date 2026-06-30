'use strict';

const crypto = require('crypto');
const { logger } = require('../logger');
const { getConfig, isLoggingEnabled } = require('./config');
const { getApiRequestLogModel } = require('./db');
const {
  sanitizeHeaders,
  sanitizeQueryParams,
  serializeBody,
  safeStringify,
} = require('./LogSanitizer');
const { getCollectedQueries } = require('./QueryCollector');

class ApiRequestLogger {
  async persist(entry) {
    if (!isLoggingEnabled()) return;

    try {
      const ApiRequestLog = getApiRequestLogModel();
      await ApiRequestLog.create(entry);
    } catch (err) {
      logger.warn('[api-request-logger] Failed to persist log entry', {
        error: err.message,
        requestId: entry?.request_id,
      });
    }
  }

  persistAsync(entry) {
    setImmediate(() => {
      this.persist(entry).catch(() => {
        /* errors already logged in persist() */
      });
    });
  }

  buildEntry(req, res, context) {
    const cfg = getConfig();
    const requestId = context.requestId;
    const fullUrl = resolveFullUrl(req);
    const endpoint = resolveEndpoint(fullUrl, req);
    const queries = cfg.logQueries ? getCollectedQueries() : [];
    const queryPayload = cfg.logQueries ? safeStringify(queries) : null;

    const userId = resolveUserId(req);
    const userEmail = resolveUserEmail(req);

    return {
      request_id: requestId,
      user_id: userId != null ? Number(userId) || null : null,
      user_email: userEmail || null,
      ip_address: resolveClientIp(req),
      http_method: req.method || 'GET',
      full_url: fullUrl,
      endpoint,
      route_name: resolveRouteName(req),
      query_params: sanitizeQueryParams(req.query),
      request_headers: sanitizeHeaders(filterHeaders(req.headers)),
      request_body: serializeBody(resolveRequestBody(req), cfg.maxPayloadBytes),
      uploaded_files: resolveUploadedFiles(req),
      response_status: res.statusCode || 0,
      response_body: cfg.logResponse
        ? serializeBody(context.responseBody, cfg.maxPayloadBytes)
        : null,
      execution_time_ms: Math.max(0, Date.now() - context.startedAt),
      database_queries: queryPayload,
      database_query_count: queries.length,
      user_agent: req.headers['user-agent'] || null,
      referer: req.headers.referer || req.headers.referrer || null,
      server_name: process.env.SERVICE_NAME || null,
      environment: process.env.NODE_ENV || null,
      exception_message: context.exception?.message || null,
      stack_trace: context.exception?.stack || null,
    };
  }
}

function resolveFullUrl(req) {
  const forwarded = req.headers['x-original-url'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();

  const host = req.get('host') || req.headers.host || 'localhost';
  const protocol = req.protocol || 'http';
  const originalUrl = req.originalUrl || req.url || '/';
  return `${protocol}://${host}${originalUrl}`;
}

function resolveEndpoint(fullUrl, req) {
  try {
    const url = new URL(fullUrl);
    return url.pathname.slice(0, 512);
  } catch {
    return (req.path || req.originalUrl || '/').split('?')[0].slice(0, 512);
  }
}

function resolveRouteName(req) {
  if (req.route?.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}`.slice(0, 255);
  }
  return null;
}

function resolveUserId(req) {
  const fromUser = req.user?.userId ?? req.user?.id;
  if (fromUser != null && fromUser !== '') return fromUser;
  const header = req.headers['x-user-id'];
  if (header != null && header !== '') return header;
  return null;
}

function resolveUserEmail(req) {
  if (req.user?.email) return String(req.user.email);
  const header = req.headers['x-user-email'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return null;
}

function resolveClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 45);
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim().slice(0, 45);
  const ip = req.ip || req.socket?.remoteAddress || '0.0.0.0';
  return String(ip).replace(/^::ffff:/, '').slice(0, 45);
}

function filterHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith('x-internal')) continue;
    out[key] = value;
  }
  return out;
}

function resolveRequestBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    return req.body;
  }
  if (typeof req.rawBody === 'string' && req.rawBody.length > 0) return req.rawBody;
  if (req.body !== undefined && req.body !== null) return req.body;
  return null;
}

function resolveUploadedFiles(req) {
  const files = [];

  if (req.file) {
    files.push(pickFileMeta(req.file));
  }

  if (req.files) {
    if (Array.isArray(req.files)) {
      for (const file of req.files) files.push(pickFileMeta(file));
    } else if (typeof req.files === 'object') {
      for (const group of Object.values(req.files)) {
        if (Array.isArray(group)) {
          for (const file of group) files.push(pickFileMeta(file));
        }
      }
    }
  }

  return files.length > 0 ? files : null;
}

function pickFileMeta(file) {
  return {
    fieldname: file.fieldname || null,
    originalname: file.originalname || null,
    mimetype: file.mimetype || null,
    size: file.size ?? null,
  };
}

function createRequestId(req) {
  const existing = req.headers['x-request-id'];
  if (typeof existing === 'string' && existing.trim()) return existing.trim();
  return crypto.randomUUID();
}

const apiRequestLogger = new ApiRequestLogger();

module.exports = {
  ApiRequestLogger,
  apiRequestLogger,
  createRequestId,
  resolveFullUrl,
};
