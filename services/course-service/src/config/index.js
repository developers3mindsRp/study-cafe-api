const path = require('path');
const { useHostPersistentPath, certificatesPath } = require('../../../../shared/persistentDataRoot');

function resolveCertificatesDir() {
  if (process.env.CERTIFICATES_UPLOAD_DIR) {
    return process.env.CERTIFICATES_UPLOAD_DIR;
  }
  if (useHostPersistentPath()) {
    return certificatesPath();
  }
  return 'uploads/certificates';
}

module.exports = {
  port: parseInt(process.env.PORT || '4002', 10),
  serviceName: 'course-service',
  /** Must reach auth-service (e.g. http://auth-service:4001 in a cluster, or http://127.0.0.1:4001 locally). */
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://127.0.0.1:4001',
  /** Public site origin for certificate verification links (e.g. https://studycafe.in) */
  publicSiteUrl: process.env.PUBLIC_SITE_URL || 'http://localhost:3000',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  /**
   * Where generated PDFs are stored. Precedence: CERTIFICATES_UPLOAD_DIR → hardcoded host path
   * in production (see shared/persistentDataRoot.js) → uploads/certificates in dev.
   */
  certificatesUploadDir: resolveCertificatesDir(),
  mysql: {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'studycafe_user',
    password: process.env.MYSQL_PASSWORD || 'GDZ@p84i-F2X',
    database: process.env.MYSQL_DATABASE || 'studycafe_db',
    connectionLimit: 10,
    queueLimit: 0,
    waitForConnections: true,
  },
};
