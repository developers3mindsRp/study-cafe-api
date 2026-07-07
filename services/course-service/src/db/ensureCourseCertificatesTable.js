'use strict';

const fs = require('fs');
const path = require('path');

let ensured = false;

/**
 * Create course_certificates if missing (idempotent). Runs once per process.
 */
async function ensureCourseCertificatesTable(sequelize) {
  if (ensured) return;
  const sql = fs.readFileSync(
    path.join(__dirname, '../../scripts/create-course-certificates-table.sql'),
    'utf8',
  );
  await sequelize.query(sql);
  ensured = true;
  console.log('[course-service] course_certificates table ensured');
}

module.exports = { ensureCourseCertificatesTable };
