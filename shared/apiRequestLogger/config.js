'use strict';

const { requiredBool } = require('../env');

const DEFAULT_MAX_PAYLOAD_BYTES = 1048576;

const STATIC_IGNORE_PATHS = [
  '/health',
  '/favicon.ico',
  '/robots.txt',
];

const STATIC_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
  '.map',
]);

function loadConfig() {
  const enabled = requiredBool('API_REQUEST_LOGGER_ENABLED');

  return {
    enabled,
    logResponse: enabled,
    logQueries: enabled,
    maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    ignorePaths: [],
  };
}

let cachedConfig;

function getConfig() {
  if (!cachedConfig) cachedConfig = loadConfig();
  return cachedConfig;
}

function isLoggingEnabled() {
  return getConfig().enabled;
}

function isQueryLoggingEnabled() {
  const cfg = getConfig();
  return cfg.enabled && cfg.logQueries;
}

function shouldSkipRequest(req) {
  const cfg = getConfig();
  const pathname = getPathname(req);

  for (const pattern of cfg.ignorePaths) {
    if (pathname === pattern || pathname.startsWith(`${pattern}/`)) return true;
  }

  for (const pattern of STATIC_IGNORE_PATHS) {
    if (pathname === pattern || pathname.endsWith(pattern)) return true;
  }

  if (pathname.includes('/user-uploads') || pathname.includes('/platform/uploads')) return true;
  if (/\/download(?:\/|$)/i.test(pathname)) return true;

  const extMatch = pathname.match(/(\.[^/]+)$/);
  if (extMatch && STATIC_EXTENSIONS.has(extMatch[1].toLowerCase())) return true;

  return false;
}

function getPathname(req) {
  const raw = req.originalUrl || req.url || req.path || '/';
  const q = raw.indexOf('?');
  return q === -1 ? raw : raw.slice(0, q);
}

function shouldLogAtGateway(req) {
  const pathname = getPathname(req);
  if (!pathname.startsWith('/api/')) return true;
  return Boolean(req.apiRequestLogGatewayOnly);
}

module.exports = {
  getConfig,
  isLoggingEnabled,
  isQueryLoggingEnabled,
  shouldSkipRequest,
  shouldLogAtGateway,
  getPathname,
};
