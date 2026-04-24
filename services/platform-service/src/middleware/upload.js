const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { logger } = require('../../../../shared');
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

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const { year, month } = getYearMonthParts();
    const dest = path.join(uploadsDir, year, month);
    try {
      fs.mkdirSync(dest, { recursive: true });
    } catch (err) {
      return cb(err);
    }
    logger.info(`[upload] destination: ${dest}`);
    cb(null, dest);
  },
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
  else cb(new Error('Only image files (JPEG, PNG, GIF, WebP, SVG) are allowed'), false);
};

const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('file');

module.exports = { uploadImage, uploadsDir };
