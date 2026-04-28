const path = require('path');

const DEFAULT_PRODUCTION_ASSETS_ORIGIN = 'https://assets.studycafe.in';

/**
 * @param {Date} [d]
 * @returns {{ year: string, month: string }} WordPress-style (month zero-padded)
 */
function getYearMonthParts(d = new Date()) {
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return { year, month };
}

/**
 * Path relative to the uploads base directory (POSIX, e.g. 2026/04/name.jpg).
 * @param {string} uploadsRoot
 * @param {string} fileAbsolutePath
 */
function relativePathFromFile(uploadsRoot, fileAbsolutePath) {
  let rel = path.relative(uploadsRoot, fileAbsolutePath);
  if (path.sep !== '/') rel = rel.split(path.sep).join('/');
  return rel;
}

function resolveAssetsOrigin() {
  if (process.env.ASSETS_BASE_URL) {
    return process.env.ASSETS_BASE_URL.replace(/\/$/, '');
  }
  return DEFAULT_PRODUCTION_ASSETS_ORIGIN;
}

/**
 * Public URL for a file under the uploads base (served at /uploads/ on assets host).
 *
 * Always returns an absolute URL so the value persisted in the database is the
 * exact URL the frontend should render. Defaults to https://assets.studycafe.in;
 * override with ASSETS_BASE_URL (e.g. for staging).
 *
 * @param {string} relativePath - e.g. 2026/04/file.jpg
 * @param {'platform' | 'user'} [_whichApi] - retained for API compatibility (unused)
 */
function publicMediaUrl(relativePath, _whichApi) {
  const rel = String(relativePath || '').replace(/^\/+/, '');
  const origin = resolveAssetsOrigin();
  return `${origin}/uploads/${rel}`;
}

module.exports = {
  getYearMonthParts,
  relativePathFromFile,
  publicMediaUrl,
  DEFAULT_PRODUCTION_ASSETS_ORIGIN,
};
