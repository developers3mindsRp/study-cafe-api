const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { logger } = require('../../../../shared');

// UPLOADS_DIR env var lets Docker map a persistent volume (e.g. /app/uploads).
// Falls back to <project-root>/uploads so local dev keeps working without any env setup.
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(__dirname, '../../../../uploads');

try {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info(`[upload] uploads directory ready: ${uploadsDir}`);
} catch (err) {
  logger.error(`[upload] failed to create uploads directory at ${uploadsDir}: ${err.message}`);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeExt = /^\.(jpe?g|png|gif|webp|svg)$/i.test(ext) ? ext : '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${safeExt}`;
    logger.info(`[upload] saving file: ${name} → ${uploadsDir}`);
    cb(null, name);
  },
});

const imageFilter = (_req, file, cb) => {
  const allowed = /^image\/(jpeg|png|gif|webp|svg\+xml)$/i.test(file.mimetype);
  if (allowed) cb(null, true);
  else cb(new Error('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed'), false);
};

const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('file');

module.exports = { uploadImage, uploadsDir };
