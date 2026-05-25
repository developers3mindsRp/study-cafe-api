const path = require('path');
const { required } = require('./env');

function resolveAssetsOrigin() {
  return required('ASSETS_BASE_URL').replace(/\/$/, '');
}

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

/**
 * Public URL for a file under the uploads base (served at /uploads/ on assets host).
 *
 * Always returns an absolute URL so the value persisted in the database is the
 * exact URL the frontend should render. Set ASSETS_BASE_URL in .env.
 *
 * @param {string} relativePath - e.g. 2026/04/file.jpg
 * @param {'platform' | 'user'} [_whichApi] - retained for API compatibility (unused)
 */
function publicMediaUrl(relativePath, _whichApi) {
  const rel = String(relativePath || '').replace(/^\/+/, '');
  const origin = resolveAssetsOrigin();
  return `${origin}/uploads/${rel}`;
}

const STUDYCAFE_UPLOAD_PATH_RE = /^https?:\/\/(?:www\.)?studycafe\.in(\/wp-content\/uploads\/.*)$/i;
const STUDYCAFE_UPLOAD_IN_CONTENT_RE = /https?:\/\/(?:www\.)?studycafe\.in(\/wp-content\/uploads\/[^"'\\\s<>]*)/gi;

/**
 * Rewrite legacy WordPress upload URLs from studycafe.in → assets.studycafe.in.
 * Only affects /wp-content/uploads/ paths on the studycafe.in domain; third-party URLs are unchanged.
 *
 * @param {string|null|undefined} url
 * @returns {string|null|undefined}
 */
function rewriteStudycafeUploadUrl(url) {
  if (url == null || url === '') return url;
  const s = String(url).trim();
  const match = s.match(STUDYCAFE_UPLOAD_PATH_RE);
  if (!match) return url;
  return `${resolveAssetsOrigin()}${match[1]}`;
}

/**
 * Rewrite all embedded studycafe.in wp-content/uploads URLs inside HTML/JSON content.
 *
 * @param {string|null|undefined} content
 * @returns {string|null|undefined}
 */
function rewriteStudycafeUploadUrlsInContent(content) {
  if (content == null || content === '') return content;
  const origin = resolveAssetsOrigin();
  return String(content).replace(STUDYCAFE_UPLOAD_IN_CONTENT_RE, `${origin}$1`);
}

module.exports = {
  getYearMonthParts,
  relativePathFromFile,
  publicMediaUrl,
  rewriteStudycafeUploadUrl,
  rewriteStudycafeUploadUrlsInContent,
};
