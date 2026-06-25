#!/usr/bin/env node
/**
 * Full membership plan course audit: plan_courses, plan_course_categories, tier logic, API simulation.
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const { Sequelize, QueryTypes } = require('sequelize');
const { migrationTgtConfig } = require('../shared/env');

const TGT = migrationTgtConfig();

const TIER_INCLUDES = {
  basic: ['basic'],
  premium: ['basic', 'premium'],
  ultimate: ['basic', 'premium', 'ultimate'],
};

function courseTypeToTier(courseType) {
  const t = String(courseType || '').trim().toLowerCase();
  if (t === 'basic') return 'basic';
  if (t === 'advanced' || t === 'advance') return 'premium';
  if (t === 'premium') return 'ultimate';
  return null;
}

async function main() {
  const db = new Sequelize(TGT.database, TGT.user, TGT.password, {
    host: TGT.host, port: TGT.port, dialect: 'mysql', logging: false,
  });
  await db.authenticate();

  const plans = await db.query(
    `SELECT id, name, slug, is_active FROM premium_plans ORDER BY sort_order, id`,
    { type: QueryTypes.SELECT },
  );

  console.log('══════════════════════════════════════════════════════════════════');
  console.log(' MEMBERSHIP COURSE AUDIT — ALL PLANS');
  console.log(' DB:', `${TGT.host}/${TGT.database}`);
  console.log('══════════════════════════════════════════════════════════════════\n');

  const report = [];

  for (const plan of plans) {
    const slug = String(plan.slug || '').toLowerCase();

    const [directRows] = await db.query(
      `SELECT pc.course_id, c.title, c.course_type, c.is_published, c.status
       FROM plan_courses pc
       LEFT JOIN courses c ON c.id = pc.course_id
       WHERE pc.plan_id = :pid
       ORDER BY pc.course_id`,
      { replacements: { pid: plan.id }, type: QueryTypes.SELECT },
    );
    const directRowsArr = Array.isArray(directRows) ? [directRows].flat() : directRows;
    // Sequelize SELECT returns array directly for single query
    const directList = await db.query(
      `SELECT pc.course_id, c.title, c.course_type, c.is_published, c.status
       FROM plan_courses pc
       LEFT JOIN courses c ON c.id = pc.course_id
       WHERE pc.plan_id = :pid
       ORDER BY pc.course_id`,
      { replacements: { pid: plan.id }, type: QueryTypes.SELECT },
    );

    const catList = await db.query(
      `SELECT pcc.course_cat_id, cc.name AS cat_name
       FROM plan_course_categories pcc
       LEFT JOIN course_cats cc ON cc.id = pcc.course_cat_id
       WHERE pcc.plan_id = :pid`,
      { replacements: { pid: plan.id }, type: QueryTypes.SELECT },
    );

    const directIds = directList.map((r) => Number(r.course_id));
    const uniqueDirect = new Set(directIds);
    const duplicateDirect = directIds.length - uniqueDirect.size;

    const catIds = catList.map((r) => Number(r.course_cat_id)).filter(Boolean);
    let expandedFromCats = [];
    if (catIds.length) {
      expandedFromCats = await db.query(
        `SELECT DISTINCT cc.course_id, c.title, c.is_published
         FROM course_categories cc
         INNER JOIN courses c ON c.id = cc.course_id
         WHERE cc.course_cat_id IN (:catIds)`,
        { replacements: { catIds }, type: QueryTypes.SELECT },
      );
    }

    const expandedCatIds = new Set(expandedFromCats.map((r) => Number(r.course_id)));
    const mergedIds = new Set([...uniqueDirect, ...expandedCatIds]);

    const publishedDirect = directList.filter((r) => r.is_published === 1).length;
    const unpublishedDirect = directList.filter((r) => r.is_published === 0 || r.is_published == null).length;
    const orphanedDirect = directList.filter((r) => !r.title).length;

    // Tier-based expected count (migration logic)
    let tierExpected = null;
    let tierOnlyExtra = [];
    if (slug in TIER_INCLUDES) {
      const tiers = TIER_INCLUDES[slug];
      const tierCourses = await db.query(
        `SELECT id, title, course_type, is_published FROM courses
         WHERE course_type IS NOT NULL
           AND title NOT LIKE 'DUP %'
           AND title NOT LIKE '%membership plan%'`,
        { type: QueryTypes.SELECT },
      );
      const expectedIds = new Set();
      for (const c of tierCourses) {
        const tier = courseTypeToTier(c.course_type);
        if (tier && tiers.includes(tier)) expectedIds.add(Number(c.id));
      }
      tierExpected = expectedIds.size;
      tierOnlyExtra = [...expectedIds].filter((id) => !uniqueDirect.has(id));
    }

    const apiSimCount = mergedIds.size;

    report.push({
      planId: plan.id,
      name: plan.name,
      slug,
      active: plan.is_active,
      directCount: uniqueDirect.size,
      directRawRows: directIds.length,
      duplicateDirect,
      publishedDirect,
      unpublishedDirect,
      orphanedDirect,
      categoryCount: catIds.length,
      expandedFromCats: expandedCatIds.size,
      apiSimCount,
      tierExpected,
      tierOnlyExtraCount: tierOnlyExtra.length,
      adminVsTierDelta: tierExpected != null ? uniqueDirect.size - tierExpected : null,
    });

    console.log(`\n── ${plan.name} (${slug}) plan_id=${plan.id} active=${plan.is_active} ──`);
    console.log(`  plan_courses (direct):     ${uniqueDirect.size} unique (${directIds.length} rows, dup=${duplicateDirect})`);
    console.log(`    published: ${publishedDirect}  unpublished/draft: ${unpublishedDirect}  orphaned: ${orphanedDirect}`);
    console.log(`  plan_course_categories:    ${catIds.length} categories`);
    if (catIds.length) {
      catList.forEach((c) => console.log(`    cat_id=${c.course_cat_id} name=${c.cat_name}`));
    }
    console.log(`  expanded from categories:  ${expandedCatIds.size} courses`);
    console.log(`  API merged total (sim):    ${apiSimCount} (direct ∪ category)`);
    if (tierExpected != null) {
      console.log(`  tier-migration expected:   ${tierExpected} courses`);
      console.log(`  in tier but NOT in plan_courses: ${tierOnlyExtra.length}`);
      console.log(`  in plan_courses but NOT tier-only: ${[...uniqueDirect].filter((id) => !tierOnlyExtra.length && tierExpected).length}`);
      const notInTier = [...uniqueDirect].filter((id) => {
        // check if id is in tier expected set
        return false; // computed below
      });
    }
  }

  // Duplicate check across entire plan_courses table
  const dupGlobal = await db.query(
    `SELECT plan_id, course_id, COUNT(*) c
     FROM plan_courses
     GROUP BY plan_id, course_id
     HAVING c > 1`,
    { type: QueryTypes.SELECT },
  );

  console.log('\n══════════════════════════════════════════════════════════════════');
  console.log(' SUMMARY TABLE');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log(
    'Plan'.padEnd(14),
    'Slug'.padEnd(10),
    'Direct'.padStart(7),
    'Cats'.padStart(5),
    'CatExp'.padStart(7),
    'API'.padStart(5),
    'Tier'.padStart(5),
    'Dup'.padStart(4),
    'Unpub'.padStart(6),
  );
  console.log('-'.repeat(72));
  for (const r of report) {
    console.log(
      r.name.slice(0, 13).padEnd(14),
      r.slug.slice(0, 9).padEnd(10),
      String(r.directCount).padStart(7),
      String(r.categoryCount).padStart(5),
      String(r.expandedFromCats).padStart(7),
      String(r.apiSimCount).padStart(5),
      String(r.tierExpected ?? '-').padStart(5),
      String(r.duplicateDirect).padStart(4),
      String(r.unpublishedDirect).padStart(6),
    );
  }

  console.log(`\nGlobal duplicate (plan_id, course_id) pairs: ${dupGlobal.length}`);

  // Ultimate deep dive: 54 published vs 103 total
  const ultimate = report.find((r) => r.slug === 'ultimate');
  if (ultimate) {
    const pubOnly = await db.query(
      `SELECT COUNT(*) c FROM plan_courses pc
       INNER JOIN courses c ON c.id = pc.course_id AND c.is_published = 1
       INNER JOIN premium_plans pp ON pp.id = pc.plan_id
       WHERE pp.slug = 'ultimate'`,
      { type: QueryTypes.SELECT },
    );
    console.log('\n── Ultimate deep dive ──');
    console.log(`  plan_courses with is_published=1: ${pubOnly[0].c}`);
    console.log(`  Admin UI shows published courses in picker (~${pubOnly[0].c} selected badge)`);
    console.log(`  User API should return published plan_courses only (admin-curated mode)`);
  }

  await db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
