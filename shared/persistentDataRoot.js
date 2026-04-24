/**
 * All persistent file storage (uploads, certificates) uses this host path in production
 * so data survives git pull / redeploy. Not driven by environment variables.
 * Change the constant only if the server layout requires a different root.
 */
const path = require('path');

const PERSISTENT_DATA_ROOT = '/var/lib/studycafe-ms';

function useHostPersistentPath() {
  return process.env.NODE_ENV === 'production';
}

function platformUploadsPath() {
  return path.join(PERSISTENT_DATA_ROOT, 'platform-uploads');
}

function userUploadsPath() {
  return path.join(PERSISTENT_DATA_ROOT, 'user-uploads');
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
