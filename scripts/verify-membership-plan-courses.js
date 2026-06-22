#!/usr/bin/env node
/**
 * Compare membership plan course mappings: source (sc_courses tier logic) vs target (plan_courses).
 *
 * Usage: node scripts/verify-membership-plan-courses.js
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const { Sequelize, QueryTypes } = require('sequelize');
const { migrationSrcConfig, migrationTgtConfig } = require('../shared/env');

const SRC = migrationSrcConfig();
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

function isExcludedCourseTitle(title) {
  const s = String(title || '');
  return /^DUP /i.test(s) || /membership plan/i.test(s);
}

function buildExpectedFromSource(scCourses, wpPostIdToCourseId, courseIdSet) {
  const coursesByTier = { basic: [], premium: [], ultimate: [] };
  const unmapped = [];
  const excluded = { dup: 0, membershipProduct: 0, paidFree: 0 };

  for (const c of scCourses) {
    const title = String(c.title || '');
    if (/^DUP /i.test(title)) { excluded.dup++; continue; }
    if (/membership plan/i.test(title)) { excluded.membershipProduct++; continue; }

    const tier = courseTypeToTier(c.course_type);
    if (!tier) { excluded.paidFree++; continue; }

    const targetCourseId =
      (c.wp_post_id != null && wpPostIdToCourseId[Number(c.wp_post_id)]) ||
      (courseIdSet.has(Number(c.id)) ? Number(c.id) : null);

    if (!targetCourseId) {
      unmapped.push({ id: c.id, wp_post_id: c.wp_post_id, title: c.title, course_type: c.course_type, tier });
      continue;
    }
    coursesByTier[tier].push({ courseId: targetCourseId, title: c.title, course_type: c.course_type });
  }

  const expectedByPlan = {};
  for (const [slug, tiers] of Object.entries(TIER_INCLUDES)) {
    const ids = new Set();
    const courses = [];
    tiers.forEach((t) => {
      coursesByTier[t].forEach((row) => {
        if (!ids.has(row.courseId)) {
          ids.add(row.courseId);
          courses.push(row);
        }
      });
    });
    expectedByPlan[slug] = { count: ids.size, courseIds: ids, courses };
  }

  return { expectedByPlan, coursesByTier, unmapped, excluded };
}

function buildExpectedFromTargetCourses(courseRows) {
  const coursesByTier = { basic: [], premium: [], ultimate: [] };
  for (const c of courseRows) {
    if (isExcludedCourseTitle(c.title)) continue;
    const tier = courseTypeToTier(c.course_type);
    if (!tier) continue;
    coursesByTier[tier].push({ courseId: Number(c.id), title: c.title, course_type: c.course_type });
  }

  const expectedByPlan = {};
  for (const [slug, tiers] of Object.entries(TIER_INCLUDES)) {
    const ids = new Set();
    tiers.forEach((t) => coursesByTier[t].forEach((row) => ids.add(row.courseId)));
    expectedByPlan[slug] = { count: ids.size, courseIds: ids };
  }
  return expectedByPlan;
}

async function main() {
  const src = new Sequelize(SRC.database, SRC.user, SRC.password, {
    host: SRC.host, port: SRC.port, dialect: 'mysql', logging: false,
  });
  const tgt = new Sequelize(TGT.database, TGT.user, TGT.password, {
    host: TGT.host, port: TGT.port, dialect: 'mysql', logging: false,
  });

  await src.authenticate();
  await tgt.authenticate();

  const [hasScCourses] = await src.query(
    "SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sc_courses'",
    { type: QueryTypes.SELECT },
  );
  if (!Number(hasScCourses?.c)) {
    console.error('Source DB has no sc_courses table.');
    process.exit(1);
  }

  const scCourses = await src.query(
    'SELECT id, wp_post_id, course_type, title FROM sc_courses ORDER BY id',
    { type: QueryTypes.SELECT },
  );

  const targetCourses = await tgt.query(
    'SELECT id, wp_post_id, course_type, title FROM courses ORDER BY id',
    { type: QueryTypes.SELECT },
  );

  const wpPostIdToCourseId = {};
  const courseIdSet = new Set();
  targetCourses.forEach((c) => {
    courseIdSet.add(Number(c.id));
    if (c.wp_post_id != null) wpPostIdToCourseId[Number(c.wp_post_id)] = Number(c.id);
  });

  const { expectedByPlan, coursesByTier, unmapped, excluded } = buildExpectedFromSource(
    scCourses, wpPostIdToCourseId, courseIdSet,
  );
  const targetExpected = buildExpectedFromTargetCourses(targetCourses);

  const plans = await tgt.query(
    'SELECT id, name, slug, is_active, sort_order FROM premium_plans ORDER BY sort_order, id',
    { type: QueryTypes.SELECT },
  );

  const actualRows = await tgt.query(
    `SELECT pp.id plan_id, pp.slug, pp.name, pp.is_active, pc.course_id
     FROM premium_plans pp
     LEFT JOIN plan_courses pc ON pc.plan_id = pp.id
     ORDER BY pp.sort_order, pp.id, pc.course_id`,
    { type: QueryTypes.SELECT },
  );

  const actualByPlanId = new Map();
  for (const row of actualRows) {
    if (!actualByPlanId.has(row.plan_id)) {
      actualByPlanId.set(row.plan_id, {
        plan_id: row.plan_id,
        slug: row.slug,
        name: row.name,
        is_active: row.is_active,
        courseIds: new Set(),
      });
    }
    if (row.course_id != null) actualByPlanId.get(row.plan_id).courseIds.add(Number(row.course_id));
  }

  // course_type distribution in source
  const typeDist = {};
  for (const c of scCourses) {
    if (isExcludedCourseTitle(c.title)) continue;
    const key = String(c.course_type || '').trim() || '(empty)';
    typeDist[key] = (typeDist[key] || 0) + 1;
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' MEMBERSHIP PLAN COURSE VERIFICATION REPORT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Source: ${SRC.host}/${SRC.database}  |  Target: ${TGT.host}/${TGT.database}`);
  console.log(`Source sc_courses: ${scCourses.length}  |  Target courses: ${targetCourses.length}`);
  console.log('\n--- Source course_type distribution (excl. DUP / membership products) ---');
  Object.entries(typeDist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\n--- Tier bucket counts (source, mapped to target course IDs) ---');
  for (const [tier, list] of Object.entries(coursesByTier)) {
    console.log(`  ${tier}: ${list.length} courses`);
  }

  console.log('\n--- Excluded from membership (source) ---');
  console.log(`  DUP titles: ${excluded.dup}`);
  console.log(`  Membership products: ${excluded.membershipProduct}`);
  console.log(`  Paid/Free/unknown type: ${excluded.paidFree}`);

  if (unmapped.length) {
    console.log(`\n⚠️  ${unmapped.length} tier-tagged source courses could not map to target course IDs:`);
    unmapped.slice(0, 15).forEach((u) => {
      console.log(`  sc_id=${u.id} wp=${u.wp_post_id} type=${u.course_type} tier=${u.tier} | ${u.title}`);
    });
    if (unmapped.length > 15) console.log(`  ... and ${unmapped.length - 15} more`);
  } else {
    console.log('\n✅ All tier-tagged source courses map to target course IDs.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' PLAN COMPARISON (old tier logic vs new plan_courses)');
  console.log('═══════════════════════════════════════════════════════════════');

  const tierSlugs = new Set(['basic', 'premium', 'ultimate']);
  const report = [];

  for (const plan of plans) {
    const slug = String(plan.slug || '').toLowerCase();
    const actual = actualByPlanId.get(plan.id) || { courseIds: new Set() };
    const actualCount = actual.courseIds.size;

    let expectedCount = null;
    let missing = [];
    let extra = [];
    let status = 'n/a';

    if (tierSlugs.has(slug)) {
      const expected = expectedByPlan[slug];
      expectedCount = expected.count;
      const expectedIds = expected.courseIds;
      missing = [...expectedIds].filter((id) => !actual.courseIds.has(id));
      extra = [...actual.courseIds].filter((id) => !expectedIds.has(id));
      status = missing.length === 0 && extra.length === 0 && actualCount === expectedCount ? 'OK' : 'MISMATCH';
    } else if (actualCount > 0) {
      status = 'CUSTOM (has manual course links)';
      expectedCount = 0;
    } else {
      status = plan.is_active ? 'NO LINKS (non-tier plan)' : 'INACTIVE / no links';
      expectedCount = 0;
    }

    report.push({
      plan: plan.name,
      slug,
      active: !!plan.is_active,
      oldCount: expectedCount,
      newCount: actualCount,
      missing: missing.length,
      extra: extra.length,
      status,
      missingIds: missing,
      extraIds: extra,
    });

    console.log(`\n${plan.name} (${slug}) [active=${plan.is_active ? 'yes' : 'no'}]`);
    console.log(`  Status: ${status}`);
    if (tierSlugs.has(slug)) {
      console.log(`  Old system (tier-based): ${expectedCount} courses`);
      console.log(`  New system (plan_courses): ${actualCount} courses`);
      if (missing.length) console.log(`  Missing in new: ${missing.length}`);
      if (extra.length) console.log(`  Extra in new: ${extra.length}`);
    } else {
      console.log(`  plan_courses: ${actualCount} (non-tier plan — not auto-synced)`);
    }
  }

  // Cross-check: target courses table tier logic vs plan_courses
  console.log('\n--- Cross-check: target courses.course_type vs plan_courses ---');
  for (const slug of ['basic', 'premium', 'ultimate']) {
    const fromCourses = targetExpected[slug].count;
    const fromLinks = report.find((r) => r.slug === slug)?.newCount ?? 0;
    const match = fromCourses === fromLinks ? 'OK' : 'MISMATCH';
    console.log(`  ${slug}: courses table expects ${fromCourses}, plan_courses has ${fromLinks} → ${match}`);
  }

  // Sample missing course titles for tier plans with issues
  const mismatched = report.filter((r) => r.status === 'MISMATCH');
  if (mismatched.length) {
    console.log('\n--- Missing course details (first 10 per mismatched tier plan) ---');
    for (const row of mismatched) {
      if (!tierSlugs.has(row.slug)) continue;
      const expected = expectedByPlan[row.slug];
      const titleById = new Map(expected.courses.map((c) => [c.courseId, c.title]));
      console.log(`\n${row.plan} (${row.slug}) — missing ${row.missingIds.length}:`);
      row.missingIds.slice(0, 10).forEach((id) => {
        console.log(`  id=${id} | ${titleById.get(id) || '(title unknown)'}`);
      });
    }
  }

  // rel_course legacy meta check
  const [hasPostmeta] = await src.query(
    "SELECT COUNT(*) c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'deepak_postmeta'",
    { type: QueryTypes.SELECT },
  );
  if (Number(hasPostmeta?.c)) {
    const relRows = await src.query(
      `SELECT pm.post_id, pm.meta_value, p.post_title
       FROM deepak_postmeta pm
       LEFT JOIN deepak_posts p ON p.ID = pm.post_id
       WHERE pm.meta_key = 'rel_course' AND pm.meta_value IS NOT NULL AND TRIM(pm.meta_value) != '' AND pm.meta_value != 'a:0:{}'
       LIMIT 20`,
      { type: QueryTypes.SELECT },
    );
    console.log(`\n--- Legacy rel_course postmeta (non-empty): ${relRows.length} sample rows ---`);
    relRows.forEach((r) => console.log(`  post_id=${r.post_id} title=${r.post_title} value=${String(r.meta_value).slice(0, 80)}`));
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('Plan Name'.padEnd(22), 'Slug'.padEnd(12), 'Old'.padStart(5), 'New'.padStart(5), 'Status');
  console.log('-'.repeat(60));
  for (const r of report) {
    console.log(
      r.plan.padEnd(22),
      r.slug.padEnd(12),
      String(r.oldCount ?? '-').padStart(5),
      String(r.newCount).padStart(5),
      r.status,
    );
  }

  const anyMismatch = mismatched.length > 0;
  console.log(anyMismatch ? '\n❌ Mismatches found — plan_courses need rebuild.' : '\n✅ All tier plans match old system course counts.');

  await src.close();
  await tgt.close();
  process.exit(anyMismatch ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
