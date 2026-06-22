#!/usr/bin/env node
/**
 * Audit Article and Course SEO migration: compare staging (sc_*) vs microservice tables.
 *
 * Env: MIGRATION_SRC_* and MIGRATION_TGT_* (same as migrate-wp-to-ms.js)
 *      or MYSQL_* for target-only checks.
 *
 * Usage: node scripts/audit-article-course-seo-migration.js
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const mysql = require('mysql2/promise');
const { migrationSrcConfig, migrationTgtConfig, mysqlConfig: getMysqlConfig } = require('../shared/env');

const SEO_FIELDS = [
  'meta_title',
  'meta_description',
  'meta_keywords',
  'canonical_url',
  'robots',
  'og_title',
  'og_description',
  'og_image_url',
];

const ARTICLE_BLOG_PATH_RE = /^\/blogs\/.+$/i;
const COURSE_DETAIL_PATH_RE = /^\/course\/.+$/i;
const ARTICLE_HTML_PATH_RE = /^\/(.+)\.html$/i;

function canonicalSlug(slug) {
  const raw = String(slug || '').trim();
  if (!raw) return '';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function isModuleDetailSeoPath(pageSlug) {
  const key = canonicalSlug(pageSlug);
  if (!key) return false;
  return (
    ARTICLE_BLOG_PATH_RE.test(key)
    || COURSE_DETAIL_PATH_RE.test(key)
    || ARTICLE_HTML_PATH_RE.test(key)
  );
}

function norm(v) {
  if (v == null) return '';
  return String(v).trim();
}

function fieldMismatch(srcVal, tgtVal) {
  return norm(srcVal) !== norm(tgtVal);
}

async function connectFromConfig(cfg) {
  return mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
  });
}

async function auditEntityPair(label, srcConn, tgtConn, srcTable, tgtTable, idCol = 'id') {
  const report = {
    label,
    srcCount: 0,
    tgtCount: 0,
    missingInTarget: [],
    basicMetaMismatches: [],
    extendedFieldGaps: {},
    samples: [],
  };

  for (const f of ['canonical_url', 'robots', 'og_title', 'og_description', 'og_image_url']) {
    report.extendedFieldGaps[f] = { emptyInTarget: 0, populatedInTarget: 0 };
  }

  let srcRows = [];
  try {
    const srcFields =
      srcTable === 'sc_articles'
        ? 'id, wp_post_id, slug, title, meta_title, meta_description, meta_keywords, thumbnail_url'
        : `${idCol} AS id, wp_post_id, slug, title, meta_title, meta_description, meta_keywords,
              canonical_url, robots, og_title, og_description, og_image_url, thumbnail_url`;
    const [rows] = await srcConn.query(
      `SELECT ${srcFields} FROM ${srcTable}`
    );
    srcRows = rows;
  } catch (err) {
    console.warn(`[${label}] Source table ${srcTable} unavailable: ${err.message}`);
    const [rows] = await tgtConn.query(
      `SELECT id, slug, title, meta_title, meta_description, meta_keywords,
              canonical_url, robots, og_title, og_description, og_image_url, thumbnail_url
       FROM ${tgtTable}`
    );
    report.tgtCount = rows.length;
    for (const row of rows) {
      for (const f of ['canonical_url', 'robots', 'og_title', 'og_description', 'og_image_url']) {
        if (norm(row[f])) report.extendedFieldGaps[f].populatedInTarget += 1;
        else report.extendedFieldGaps[f].emptyInTarget += 1;
      }
    }
    return report;
  }

  report.srcCount = srcRows.length;

  const [tgtRows] = await tgtConn.query(
    `SELECT id, slug, title, meta_title, meta_description, meta_keywords,
            canonical_url, robots, og_title, og_description, og_image_url, thumbnail_url
     FROM ${tgtTable}`
  );
  report.tgtCount = tgtRows.length;

  const tgtById = new Map(tgtRows.map((r) => [Number(r.id), r]));
  const tgtBySlug = new Map(tgtRows.map((r) => [norm(r.slug), r]));

  for (const src of srcRows) {
    const tgt =
      tgtById.get(Number(src.id))
      || tgtById.get(Number(src.wp_post_id))
      || tgtBySlug.get(norm(src.slug));
    if (!tgt) {
      report.missingInTarget.push({ id: src.id, slug: src.slug, title: src.title });
      continue;
    }

    if (
      fieldMismatch(src.meta_title, tgt.meta_title)
      || fieldMismatch(src.meta_description, tgt.meta_description)
      || fieldMismatch(src.meta_keywords, tgt.meta_keywords)
    ) {
      report.basicMetaMismatches.push({
        id: tgt.id,
        slug: tgt.slug,
        title: tgt.title,
        src: {
          meta_title: src.meta_title,
          meta_description: src.meta_description,
          meta_keywords: src.meta_keywords,
        },
        tgt: {
          meta_title: tgt.meta_title,
          meta_description: tgt.meta_description,
          meta_keywords: tgt.meta_keywords,
        },
      });
    }

    for (const f of ['canonical_url', 'robots', 'og_title', 'og_description', 'og_image_url']) {
      if (norm(tgt[f])) report.extendedFieldGaps[f].populatedInTarget += 1;
      else report.extendedFieldGaps[f].emptyInTarget += 1;
    }
  }

  report.samples = report.basicMetaMismatches.slice(0, 5);
  return report;
}

async function auditDuplicateSeoMetadata(tgtConn) {
  const [rows] = await tgtConn.query(
    'SELECT id, page_slug, page_name, meta_title FROM seo_metadata ORDER BY id ASC'
  );
  const moduleRows = rows.filter((r) => isModuleDetailSeoPath(r.page_slug));
  return {
    total: rows.length,
    moduleManaged: moduleRows.length,
    siteOnly: rows.length - moduleRows.length,
    samples: moduleRows.slice(0, 10),
  };
}

function printReport(articleReport, courseReport, seoMetaReport) {
  console.log('\n========== ARTICLE SEO MIGRATION AUDIT ==========');
  console.log(`Source rows (sc_articles): ${articleReport.srcCount}`);
  console.log(`Target rows (articles):    ${articleReport.tgtCount}`);
  console.log(`Missing in target:         ${articleReport.missingInTarget.length}`);
  console.log(`Basic meta mismatches:     ${articleReport.basicMetaMismatches.length}`);
  console.log('Extended field coverage on target articles:');
  for (const f of ['canonical_url', 'robots', 'og_title', 'og_description', 'og_image_url']) {
    const g = articleReport.extendedFieldGaps[f];
    console.log(`  ${f}: populated=${g.populatedInTarget}, empty=${g.emptyInTarget}`);
  }
  if (articleReport.samples.length) {
    console.log('\nSample basic meta mismatches:');
    articleReport.samples.forEach((s) => {
      console.log(`  #${s.id} ${s.slug}`);
      console.log(`    src meta_title: ${norm(s.src.meta_title).slice(0, 80)}`);
      console.log(`    tgt meta_title: ${norm(s.tgt.meta_title).slice(0, 80)}`);
    });
  }

  console.log('\n========== COURSE SEO MIGRATION AUDIT ==========');
  console.log(`Source rows (sc_courses): ${courseReport.srcCount}`);
  console.log(`Target rows (courses):    ${courseReport.tgtCount}`);
  console.log(`Missing in target:        ${courseReport.missingInTarget.length}`);
  console.log(`Basic meta mismatches:    ${courseReport.basicMetaMismatches.length}`);
  console.log('Extended field coverage on target courses:');
  for (const f of ['canonical_url', 'robots', 'og_title', 'og_description', 'og_image_url']) {
    const g = courseReport.extendedFieldGaps[f];
    console.log(`  ${f}: populated=${g.populatedInTarget}, empty=${g.emptyInTarget}`);
  }

  console.log('\n========== SEO METADATA TABLE (duplicates) ==========');
  console.log(`Total rows:              ${seoMetaReport.total}`);
  console.log(`Module-managed (dupes):  ${seoMetaReport.moduleManaged}`);
  console.log(`Site/static pages:       ${seoMetaReport.siteOnly}`);
  if (seoMetaReport.samples.length) {
    console.log('Sample module rows (run cleanup-module-seo-metadata.js --execute):');
    seoMetaReport.samples.forEach((r) => {
      console.log(`  #${r.id}  ${r.page_slug}`);
    });
  }

  console.log('\n========== LEGACY WP FIELD MAPPING ==========');
  console.log('Migrated from WordPress ACF postmeta: title → meta_title, description → meta_description, keywords → meta_keywords');
  console.log('Not present in legacy WP source: canonical_url, robots, Yoast/AIOSEO fields');
  console.log('Courses: og_title/og_description/og_image_url derived at migration from meta + thumbnail');
  console.log('Articles: extended OG/canonical columns exist but were not in WP staging — use backfill-article-course-seo-fields.js');

  const ok =
    articleReport.missingInTarget.length === 0
    && articleReport.basicMetaMismatches.length === 0
    && courseReport.missingInTarget.length === 0
    && courseReport.basicMetaMismatches.length === 0;

  console.log(`\nOverall basic SEO migration: ${ok ? 'PASS' : 'NEEDS REVIEW'}`);
  if (seoMetaReport.moduleManaged > 0) {
    console.log(`Duplicate seo_metadata rows: ${seoMetaReport.moduleManaged} (run cleanup script)`);
  }
}

async function main() {
  let srcConn = null;
  let tgtConn = null;

  try {
    try {
      const srcCfg = migrationSrcConfig();
      srcConn = await connectFromConfig(srcCfg);
    } catch (_) {
      console.log('MIGRATION_SRC_* not configured — skipping source comparison.');
    }

    const tgtCfg = (() => {
      try {
        return migrationTgtConfig();
      } catch (_) {
        return getMysqlConfig();
      }
    })();
    tgtConn = await connectFromConfig(tgtCfg);

    const articleReport = await auditEntityPair(
      'articles',
      srcConn,
      tgtConn,
      'sc_articles',
      'articles'
    );
    const courseReport = await auditEntityPair(
      'courses',
      srcConn,
      tgtConn,
      'sc_courses',
      'courses'
    );
    const seoMetaReport = await auditDuplicateSeoMetadata(tgtConn);

    printReport(articleReport, courseReport, seoMetaReport);
  } finally {
    if (srcConn) await srcConn.end();
    if (tgtConn) await tgtConn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
