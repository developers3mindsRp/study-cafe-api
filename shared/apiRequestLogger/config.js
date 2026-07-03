'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const ENV_FILE = path.resolve(__dirname, '../../.env');
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

let cachedLoggerEnabled;
let cachedEnvMtimeMs;

function parseEnabledValue(raw, fallback = false) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`Invalid boolean for API_REQUEST_LOGGER_ENABLED: ${raw}`);
}

/**
 * Read logger toggle from repo-root .env so it is not stuck on a stale
 * process.env value (dotenv does not override existing shell/PM2 vars).
 */
function isLoggingEnabled() {
  try {
    const stat = fs.statSync(ENV_FILE);
    if (cachedEnvMtimeMs !== stat.mtimeMs) {
      const parsed = dotenv.parse(fs.readFileSync(ENV_FILE));
      cachedLoggerEnabled = parseEnabledValue(parsed.API_REQUEST_LOGGER_ENABLED, false);
      cachedEnvMtimeMs = stat.mtimeMs;
    }
    return cachedLoggerEnabled;
  } catch {
    return parseEnabledValue(process.env.API_REQUEST_LOGGER_ENABLED, false);
  }
}

function getConfig() {
  const enabled = isLoggingEnabled();
  return {
    enabled,
    logResponse: enabled,
    logQueries: enabled,
    maxPayloadBytes: DEFAULT_MAX_PAYLOAD_BYTES,
    ignorePaths: [],
  };
}

function isQueryLoggingEnabled() {
  return isLoggingEnabled();
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
