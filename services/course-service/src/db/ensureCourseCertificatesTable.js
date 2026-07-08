'use strict';

const fs = require('fs');
const path = require('path');

let ensured = false;

/**
 * Create course_certificates + certificate_counter if missing, and reconcile an older per-course
 * shape (cert_seq / uq_cert_course_seq) to the new global-serial shape. Idempotent; runs once/process.
 */
async function ensureCourseCertificatesTable(sequelize) {
  if (ensured) return;

  const sql = fs.readFileSync(
    path.join(__dirname, '../../scripts/create-course-certificates-table.sql'),
    'utf8',
  );
  await sequelize.query(sql);

  // Reconcile a table created by the earlier per-course implementation (column `cert_seq`,
  // unique key `uq_cert_course_seq`) into the global-serial shape. No-op on fresh installs.
  const [cols] = await sequelize.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_certificates'`,
  );
  const colNames = new Set(cols.map((c) => c.COLUMN_NAME));

  if (colNames.has('cert_seq') && !colNames.has('serial')) {
    // Drop the per-course unique key if present, then rename the column to `serial`.
    const [idx] = await sequelize.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_certificates'
         AND INDEX_NAME = 'uq_cert_course_seq' LIMIT 1`,
    );
    if (idx.length > 0) {
      await sequelize.query(`ALTER TABLE course_certificates DROP INDEX uq_cert_course_seq`);
    }
    await sequelize.query(
      `ALTER TABLE course_certificates CHANGE COLUMN cert_seq serial INT UNSIGNED NOT NULL`,
    );
    // Add the global-serial unique key if it isn't there yet.
    const [serialIdx] = await sequelize.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'course_certificates'
         AND INDEX_NAME = 'uq_cert_serial' LIMIT 1`,
    );
    if (serialIdx.length === 0) {
      await sequelize.query(`ALTER TABLE course_certificates ADD UNIQUE KEY uq_cert_serial (serial)`);
    }
  }

  ensured = true;
  console.log('[course-service] course_certificates + certificate_counter tables ensured');
}

module.exports = { ensureCourseCertificatesTable };
