'use strict';

const fs = require('fs');
const path = require('path');

let ensured = false;

/**
 * Create certificate_links + public_certificates + certificate_link_claims if missing.
 * Idempotent; runs once per process. Mirrors ensureCourseCertificatesTable.js.
 *
 * The driver runs one statement per query (multipleStatements is not enabled), so the .sql is
 * stripped of full-line comments and split on ';' — see the note at the top of the .sql file.
 */
async function ensureCertificateLinksTables(sequelize) {
  if (ensured) return;

  const sql = fs.readFileSync(
    path.join(__dirname, '../../scripts/create-certificate-links-tables.sql'),
    'utf8',
  );
  const statements = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sequelize.query(stmt);
  }

  ensured = true;
  console.log('[course-service] certificate_links + public_certificates + certificate_link_claims tables ensured');
}

module.exports = { ensureCertificateLinksTables };
