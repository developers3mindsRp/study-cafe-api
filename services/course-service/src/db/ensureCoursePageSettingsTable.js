'use strict';

const fs = require('fs');
const path = require('path');

let ensured = false;

/**
 * Create sc_course_page_settings if missing (idempotent). Runs once per process.
 */
async function ensureCoursePageSettingsTable(sequelize) {
  if (ensured) return;
  const sql = fs.readFileSync(
    path.join(__dirname, '../../scripts/create-course-page-settings-table.sql'),
    'utf8',
  );
  await sequelize.query(sql);
  ensured = true;
  console.log('[course-service] sc_course_page_settings table ensured');
}

module.exports = { ensureCoursePageSettingsTable };
