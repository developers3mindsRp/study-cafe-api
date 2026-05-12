const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { logger, AppError } = require('../../../../shared');
const { getYearMonthParts } = require('../../../../shared/mediaUrl');
const { useHostPersistentPath, platformUploadsPath } = require('../../../../shared/persistentDataRoot');

// Precedence: UPLOADS_DIR (override) → /var/www/.../study-cafe-media/uploads in production → <repo>/uploads in dev
function resolveUploadsDir() {
  if (process.env.UPLOADS_DIR) {
    return path.resolve(process.env.UPLOADS_DIR);
  }
  if (useHostPersistentPath()) {
    return platformUploadsPath();
  }
  return path.join(__dirname, '../../../../uploads');
}

const uploadsDir = resolveUploadsDir();

try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info(`[upload] uploads directory ready: ${uploadsDir}`);
} catch (err) {
  logger.error(`[upload] failed to create uploads directory at ${uploadsDir}: ${err.message}`);
}

// Shared destination resolver — every upload (image, document, etc.) lands under
// uploadsDir/YYYY/MM so admin CMS images, user avatars and download files all live
// side-by-side in /var/www/html/study-cafe-media/uploads/YYYY/MM in production.
function destinationToYearMonth(_req, _file, cb) {
  const { year, month } = getYearMonthParts();
  const dest = path.join(uploadsDir, year, month);
  try {
    fs.mkdirSync(dest, { recursive: true });
  } catch (err) {
    return cb(err);
  }
  logger.info(`[upload] destination: ${dest}`);
  cb(null, dest);
}

// ── Image storage (existing) ────────────────────────────────────────
const imageStorage = multer.diskStorage({
  destination: destinationToYearMonth,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeExt = /^\.(jpe?g|png|gif|webp|svg)$/i.test(ext) ? ext : '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
    cb(null, name);
  },
});

const imageFilter = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|png|gif|webp|svg\+xml)$/i.test(file.mimetype);
  if (allowed) cb(null, true);
  else cb(new AppError('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed', 400), false);
};

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('file');

// ── Generic file (PDF + Office docs) storage ───────────────────────
const ALLOWED_DOC_EXTENSIONS = /^\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i;
const ALLOWED_DOC_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Some browsers/clients send octet-stream for .doc/.xls — accept and validate via extension
  'application/octet-stream',
]);

function sanitizeBaseName(originalname) {
  const base = path
    .basename(originalname || '', path.extname(originalname || ''))
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'file';
}

const fileStorage = multer.diskStorage({
  destination: destinationToYearMonth,
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase();
    const safeExt = ALLOWED_DOC_EXTENSIONS.test(ext) ? ext : '.bin';
    const slug = sanitizeBaseName(file.originalname);
    const name = `${slug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
    cb(null, name);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = (path.extname(file.originalname) || '').toLowerCase();
  const extOk = ALLOWED_DOC_EXTENSIONS.test(ext);
  const mimeOk = ALLOWED_DOC_MIME_TYPES.has(file.mimetype);
  if (extOk && mimeOk) cb(null, true);
  else cb(new AppError('Only PDF and Office documents (.pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx) are allowed', 400), false);
};

const uploadFile = multer({
  storage: fileStorage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}).single('file');

module.exports = { uploadImage, uploadFile, uploadsDir };
