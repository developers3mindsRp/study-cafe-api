const { logger } = require('../../../../shared');

/**
 * Columns backing the post-purchase ("thank you") page configuration on a course.
 * Added on startup so a deploy does not need a separate migration step.
 */
const COLUMNS = [
  { name: 'post_purchase_links', ddl: 'LONGTEXT NULL', after: 'detail_sections' },
  { name: 'post_purchase_redirect_url', ddl: 'VARCHAR(1000) NULL', after: 'post_purchase_links' },
  { name: 'post_purchase_redirect_delay', ddl: 'INT NULL', after: 'post_purchase_redirect_url' },
];

async function ensureCoursePostPurchaseColumns(sequelize) {
  try {
    const [existing] = await sequelize.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'courses'`,
    );
    if (!existing.length) return;
    const present = new Set(
      existing.map((row) => String(row.name || row.COLUMN_NAME).toLowerCase()),
    );

    for (const column of COLUMNS) {
      if (present.has(column.name)) continue;
      // `after` may itself be a column added earlier in this loop, so it is always present by now.
      const afterClause = present.has(column.after) ? ` AFTER \`${column.after}\`` : '';
      await sequelize.query(
        `ALTER TABLE courses ADD COLUMN \`${column.name}\` ${column.ddl}${afterClause}`,
      );
      present.add(column.name);
      logger.info(`[course-service] courses.${column.name} column added`);
    }
  } catch (err) {
    logger.warn('[course-service] Could not ensure course post-purchase columns', {
      error: err?.message,
    });
  }
}

module.exports = { ensureCoursePostPurchaseColumns };
