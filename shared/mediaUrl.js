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
  if (process.env.NODE_ENV === 'production') {
    return DEFAULT_PRODUCTION_ASSETS_ORIGIN;
  }
  return null;
}

/**
 * Public URL for a file under the uploads base (served at /uploads/ on assets host).
 * @param {string} relativePath - e.g. 2026/04/file.jpg
 * @param {'platform' | 'user'} whichApi - dev fallback: /api/uploads vs /api/user-uploads
 */
function publicMediaUrl(relativePath, whichApi) {
  const rel = relativePath.replace(/^\/+/, '');
  const origin = resolveAssetsOrigin();
  if (origin) {
    return `${origin}/uploads/${rel}`;
  }
  const prefix = whichApi === 'user' ? '/api/user-uploads' : '/api/uploads';
  return `${prefix}/${rel}`;
}

module.exports = {
  getYearMonthParts,
  relativePathFromFile,
  publicMediaUrl,
  DEFAULT_PRODUCTION_ASSETS_ORIGIN,
};
