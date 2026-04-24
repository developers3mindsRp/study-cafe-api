const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { useHostPersistentPath, userUploadsPath } = require('../../../../shared/persistentDataRoot');

// Precedence: USER_UPLOADS_DIR (override) → hardcoded /var/.../user-uploads in production → <auth-service>/src/uploads in dev
const uploadDir = process.env.USER_UPLOADS_DIR
  ? path.resolve(process.env.USER_UPLOADS_DIR)
  : useHostPersistentPath()
    ? userUploadsPath()
    : path.join(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});

const uploadAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    if (!ok) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

module.exports = { uploadAvatar, uploadDir };
