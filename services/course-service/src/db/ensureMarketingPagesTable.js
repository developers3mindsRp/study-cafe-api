'use strict';

const fs = require('fs');
const path = require('path');

let ensured = false;

async function ensureMarketingPagesTable(sequelize) {
  if (ensured) return;
  const sql = fs.readFileSync(
    path.join(__dirname, '../../scripts/create-marketing-pages-table.sql'),
    'utf8',
  );
  await sequelize.query(sql);
  ensured = true;
  console.log('[course-service] marketing_pages table ensured');
}

module.exports = { ensureMarketingPagesTable };
