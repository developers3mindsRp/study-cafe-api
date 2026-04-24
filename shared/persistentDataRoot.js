/**
 * All persistent file storage (uploads, certificates) uses this host path in production
 * so data survives git pull / redeploy. Not driven by environment variables.
 * Change the constant only if the server layout requires a different root.
 */
const path = require('path');

const PERSISTENT_DATA_ROOT = '/var/lib/studycafe-ms';

/** Served by assets.studycafe.in (WordPress-style YYYY/MM under this base in production). */
const PRODUCTION_MEDIA_UPLOADS = '/var/www/html/study-cafe-media/uploads';

function useHostPersistentPath() {
  return process.env.NODE_ENV === 'production';
}

function platformUploadsPath() {
  return PRODUCTION_MEDIA_UPLOADS;
}

function userUploadsPath() {
  return PRODUCTION_MEDIA_UPLOADS;
}

function certificatesPath() {
  return path.join(PERSISTENT_DATA_ROOT, 'certificates');
}

module.exports = {
  PERSISTENT_DATA_ROOT,
  useHostPersistentPath,
  platformUploadsPath,
  userUploadsPath,
  certificatesPath,
};
