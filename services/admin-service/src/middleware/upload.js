const path = require('path');
const multer = require('multer');

const memoryStorage = multer.memoryStorage();

// ── Image (existing) ─────────────────────────────────────────────────
const imageFilter = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|png|gif|webp|svg\+xml)$/i.test(file.mimetype);
  if (allowed) cb(null, true);
  else cb(new Error('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed'), false);
};

const uploadImage = multer({
  storage: memoryStorage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('file');

// ── Generic file (PDF + Office docs) ─────────────────────────────────
// Mirrors platform-service/src/middleware/upload.js so the admin layer rejects
// disallowed types early (before forwarding) and surfaces a clean error.
const ALLOWED_DOC_EXTENSIONS = /^\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i;
const ALLOWED_DOC_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream',
]);

const fileFilter = (_req, file, cb) => {
  const ext = (path.extname(file.originalname) || '').toLowerCase();
  const extOk = ALLOWED_DOC_EXTENSIONS.test(ext);
  const mimeOk = ALLOWED_DOC_MIME_TYPES.has(file.mimetype);
  if (extOk && mimeOk) cb(null, true);
  else cb(new Error('Only PDF and Office documents (.pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx) are allowed'), false);
};

const uploadFile = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
}).single('file');

module.exports = { uploadImage, uploadFile };
