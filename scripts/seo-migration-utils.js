'use strict';

/**
 * Shared SEO migration helpers used by migrate-wp-to-ms.js and standalone scripts.
 * - backfillEntitySeoFields: populate canonical/robots/OG on articles & courses
 * - cleanupModuleSeoMetadata: remove article/course rows from seo_metadata
 */

const MODULE_SEO_WHERE_SQL = `
  page_slug REGEXP '^/course/.+'
  OR page_slug REGEXP '^/blogs/.+'
  OR page_slug REGEXP '^/.+\\\\.html$'
`;

function buildBackfillSql(table, { includeDeletedFilter = true } = {}) {
  const slugPath =
    table === 'articles'
      ? "CONCAT('/', slug, '-', id, '.html')"
      : "CONCAT('/course/', slug)";
  const deletedClause =
    includeDeletedFilter ? 'AND deleted_at IS NULL' : '';

  return `UPDATE ${table}
     SET
       canonical_url = CASE
         WHEN canonical_url IS NULL OR TRIM(canonical_url) = '' THEN LEFT(${slugPath}, 1000)
         ELSE canonical_url
       END,
       robots = CASE
         WHEN robots IS NULL OR TRIM(robots) = '' THEN 'index, follow'
         ELSE robots
       END,
       og_title = CASE
         WHEN og_title IS NULL OR TRIM(og_title) = '' THEN LEFT(
           COALESCE(NULLIF(TRIM(meta_title), ''), NULLIF(TRIM(title), '')),
           255
         )
         ELSE og_title
       END,
       og_description = CASE
         WHEN og_description IS NULL OR TRIM(og_description) = '' THEN meta_description
         ELSE og_description
       END,
       og_image_url = CASE
         WHEN og_image_url IS NULL OR TRIM(og_image_url) = '' THEN LEFT(thumbnail_url, 500)
         ELSE og_image_url
       END
     WHERE slug IS NOT NULL AND TRIM(slug) != ''
       ${deletedClause}
       AND (
         canonical_url IS NULL OR TRIM(canonical_url) = ''
         OR robots IS NULL OR TRIM(robots) = ''
         OR og_title IS NULL OR TRIM(og_title) = ''
         OR og_description IS NULL OR TRIM(og_description) = ''
         OR og_image_url IS NULL OR TRIM(og_image_url) = ''
       )`;
}

function buildCountBackfillSql(table, { includeDeletedFilter = true } = {}) {
  const deletedClause =
    includeDeletedFilter ? 'AND deleted_at IS NULL' : '';
  return `SELECT COUNT(*) AS cnt FROM ${table}
     WHERE slug IS NOT NULL AND TRIM(slug) != ''
       ${deletedClause}
       AND (
         canonical_url IS NULL OR TRIM(canonical_url) = ''
         OR robots IS NULL OR TRIM(robots) = ''
         OR og_title IS NULL OR TRIM(og_title) = ''
         OR og_description IS NULL OR TRIM(og_description) = ''
         OR og_image_url IS NULL OR TRIM(og_image_url) = ''
       )`;
}

async function tableHasColumn(runQuery, table, column) {
  try {
    const rows = await runQuery(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column]
    );
    return Number(rows?.[0]?.cnt || 0) > 0;
  } catch {
    return false;
  }
}

async function backfillEntitySeoFields(runQuery, options = {}) {
  const { dryRun = false } = options;
  const articleHasDeleted = await tableHasColumn(runQuery, 'articles', 'deleted_at');
  const courseHasDeleted = await tableHasColumn(runQuery, 'courses', 'deleted_at');

  const articleOpts = { includeDeletedFilter: articleHasDeleted };
  const courseOpts = { includeDeletedFilter: courseHasDeleted };

  if (dryRun) {
    const [articleRows, courseRows] = await Promise.all([
      runQuery(buildCountBackfillSql('articles', articleOpts)),
      runQuery(buildCountBackfillSql('courses', courseOpts)),
    ]);
    return {
      articles: Number(articleRows?.[0]?.cnt || 0),
      courses: Number(courseRows?.[0]?.cnt || 0),
      updated: { articles: 0, courses: 0 },
    };
  }

  const articleResult = await runQuery(buildBackfillSql('articles', articleOpts));
  const courseResult = await runQuery(buildBackfillSql('courses', courseOpts));

  return {
    articles: null,
    courses: null,
    updated: {
      articles: Number(articleResult?.affectedRows || 0),
      courses: Number(courseResult?.affectedRows || 0),
    },
  };
}

async function cleanupModuleSeoMetadata(runQuery, options = {}) {
  const { dryRun = false } = options;

  if (dryRun) {
    const rows = await runQuery(
      `SELECT COUNT(*) AS cnt FROM seo_metadata WHERE ${MODULE_SEO_WHERE_SQL}`
    );
    return { wouldDelete: Number(rows?.[0]?.cnt || 0), deleted: 0 };
  }

  const result = await runQuery(`DELETE FROM seo_metadata WHERE ${MODULE_SEO_WHERE_SQL}`);
  return { wouldDelete: null, deleted: Number(result?.affectedRows || 0) };
}

module.exports = {
  MODULE_SEO_WHERE_SQL,
  buildBackfillSql,
  backfillEntitySeoFields,
  cleanupModuleSeoMetadata,
};
