#!/usr/bin/env node
/**
 * Backfill the "Purchased Course" orders for an allotment whose order phase failed.
 *
 * Course allotment enrolls first and books the order second (bulkAddBatchEnrollmentByEmails
 * in admin-service). A failure in that second phase deliberately does NOT undo the
 * enrollment, so the learner keeps access while the order, payment row and revenue line are
 * missing. Re-uploading the same sheet does not repair it: phase 1 answers
 * `already_enrolled` and phase 2 only books orders for FRESH enrollments. This is the
 * repair path.
 *
 * WHY shared_payment_id IS FORCED ON
 * `payments` is UNIQUE on (razorpay_payment_id, status). The reference in the sheet has
 * usually already been consumed by the order that DID succeed — a bundle sold on one
 * settlement — which is the very reason this allotment's orders failed. Shared mode records
 * the real reference on `orders.rp_payment_id`, where it stays visible on the order, and
 * gives the payments row its own `manual:<orderId>` capture ref. Booking these any other
 * way would die on the same index all over again.
 *
 * Fulfillment is skipped by default: the learner already has access from phase 1, so
 * re-fulfilling would re-grant it and re-send the purchase email.
 *
 * DRY RUN BY DEFAULT — nothing is written without --apply. Never deletes or edits an
 * existing order; a user who already has a live order for the course is skipped, so
 * re-running after a partial failure is safe.
 *
 * Usage:
 *   node scripts/backfill-course-allotment-orders.js --file "docs/GROWTH_MAGNET (1).xlsx" --course 385618
 *   node scripts/backfill-course-allotment-orders.js --file "docs/GROWTH_MAGNET (1).xlsx" --course 385618 --apply
 *
 * Options:
 *   --file <path>   .xlsx or .csv with columns: email, amount_paid, payment_id
 *   --course <id>   course the orders are booked against (orders.entity_id)
 *   --amount <n>    override every row's amount (e.g. --amount 0 for record-only revenue)
 *   --fulfill       re-run fulfillment (grants access + sends email). Off by default.
 *   --apply         actually write. Without it, prints the plan and exits.
 *   --local         read the plan from the service database (MYSQL_*) instead of
 *                   MIGRATION_TGT_*. Use for a local rehearsal, where the plan and the
 *                   orders must come from and go to the same local database.
 */
'use strict';

try { require('../shared/env'); } catch (_) {}

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const axios = require('axios');
const { Sequelize, QueryTypes } = require('sequelize');
const { migrationTgtConfig } = require('../shared/env');

/** Connection the plan is READ from. --local points it at the service DB (MYSQL_*). */
function planDbConfig() {
  if (process.argv.includes('--local')) {
    return {
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    };
  }
  return migrationTgtConfig();
}
const TGT = planDbConfig();
const ORDER_SERVICE_URL = (process.env.ORDER_SERVICE_URL || '').replace(/\/+$/, '');
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';
const CHUNK = 25;
const REQUEST_TIMEOUT_MS = 120000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  const next = i > -1 ? process.argv[i + 1] : null;
  return next && !next.startsWith('--') ? next : fallback;
}
const flag = (name) => process.argv.includes('--' + name);

/* ── sheet parsing ─────────────────────────────────────────────────── */

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

/**
 * Minimal .xlsx reader — an xlsx is a zip of XML, and the sheet stores text as indexes
 * into sharedStrings.xml. Avoids adding a spreadsheet dependency for a repair tool. If
 * `unzip` is not on PATH, export the sheet to CSV and pass that instead.
 */
function readXlsx(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-'));
  try {
    try {
      execFileSync('unzip', ['-o', file, '-d', tmp], { stdio: 'ignore' });
    } catch (e) {
      throw new Error(
        'could not unzip ' + file + ' — is `unzip` on PATH? ' +
        'Export the sheet to CSV and pass --file <that.csv> instead. (' + e.message + ')'
      );
    }
    const sharedPath = path.join(tmp, 'xl', 'sharedStrings.xml');
    const strings = fs.existsSync(sharedPath)
      ? [...fs.readFileSync(sharedPath, 'utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
      : [];
    const sheetXml = fs.readFileSync(path.join(tmp, 'xl', 'worksheets', 'sheet1.xml'), 'utf8');
    return [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const cells = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
        const v = (c[3].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        cells[c[1]] = v === undefined ? '' : (/t="s"/.test(c[2]) ? (strings[Number(v)] || '') : v);
      }
      return cells;
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function readCsv(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line) => {
      const p = line.split(',').map((x) => x.trim().replace(/^"|"$/g, ''));
      return { A: p[0] || '', B: p[1] || '', C: p[2] || '' };
    });
}

/** Mirrors the admin panel's parsing so "₹12,979" and "Rs. 999" behave identically here. */
function normalizeAmount(raw) {
  const trimmed = String(raw == null ? '' : raw).trim();
  if (!trimmed) return 0;
  const cleaned = trimmed.replace(/^(?:rs\.?|inr)\s*/i, '').replace(/[₹,\s]/g, '');
  if (!cleaned) return 0;
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Columns are read positionally (A/B/C). A header row is normal, so a first row whose
 * email cell is not an email address is dropped rather than processed as data.
 */
function loadRows(file) {
  const raw = /\.xlsx$/i.test(file) ? readXlsx(file) : readCsv(file);
  const mapped = raw.map((c) => ({
    email: String(c.A || '').trim().toLowerCase(),
    amountRaw: String(c.B == null ? '' : c.B).trim(),
    paymentId: String(c.C || '').trim(),
  }));
  if (mapped.length && !EMAIL_RE.test(mapped[0].email)) mapped.shift();
  return mapped.filter((r) => r.email);
}

/* ── main ──────────────────────────────────────────────────────────── */

async function main() {
  const file = arg('file');
  const courseId = arg('course');
  const amountOverride = arg('amount');
  const apply = flag('apply');
  const fulfill = flag('fulfill');

  if (!file || !courseId) {
    console.error('Usage: --file <sheet.xlsx|csv> --course <courseId> [--amount N] [--fulfill] [--apply]');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error('File not found: ' + file);
    process.exit(1);
  }
  if (apply && (!ORDER_SERVICE_URL || !INTERNAL_API_KEY)) {
    console.error('ORDER_SERVICE_URL and INTERNAL_API_KEY must be set in .env to --apply');
    process.exit(1);
  }

  // The plan is read straight from MIGRATION_TGT, but the orders are written by whatever
  // database ORDER_SERVICE_URL's process is attached to (MYSQL_*). When those differ, the
  // run would plan against one database and write into another — user ids from the first
  // would land as junk rows in the second. Refuse rather than let that happen silently.
  if (apply) {
    const svcHost = process.env.MYSQL_HOST || '';
    const svcDb = process.env.MYSQL_DATABASE || '';
    const sameDb = svcDb === TGT.database &&
      (svcHost === TGT.host || ((svcHost === 'localhost' || svcHost === '127.0.0.1') &&
        (TGT.host === 'localhost' || TGT.host === '127.0.0.1')));
    if (!sameDb && !flag('force-db-mismatch')) {
      console.error('REFUSING TO APPLY — database mismatch:');
      console.error('  plan is read from   : ' + TGT.host + '/' + TGT.database + '  (MIGRATION_TGT_*)');
      console.error('  orders are written to: ' + (svcHost || '?') + '/' + (svcDb || '?') + '  (MYSQL_*, via ' + ORDER_SERVICE_URL + ')');
      console.error('');
      console.error('Run this on the server whose order-service uses the same database as the plan,');
      console.error('or point ORDER_SERVICE_URL at that order-service. Override with --force-db-mismatch');
      console.error('only if you are certain the two really are the same database.');
      process.exit(1);
    }
  }
  const rows = loadRows(file);
  if (rows.length === 0) {
    console.error('No data rows found in the sheet.');
    process.exit(1);
  }

  const db = new Sequelize(TGT.database, TGT.user, TGT.password, {
    host: TGT.host, port: TGT.port, dialect: 'mysql', logging: false,
  });
  await db.authenticate();
  const q = (sql, replacements) => db.query(sql, { replacements, type: QueryTypes.SELECT });
  // entity_id is a VARCHAR on orders — always compare as a string, never CAST.
  const cidStr = String(courseId);

  const [course] = await q('SELECT id, title FROM courses WHERE id = :id', { id: Number(courseId) });

  console.log('══════════════════════════════════════════════════════════════');
  console.log(' COURSE ALLOTMENT ORDER BACKFILL' + (apply ? '' : '   [DRY RUN]'));
  console.log(' DB     :', TGT.host + '/' + TGT.database, flag('local') ? '(service DB — MYSQL_*)' : '(MIGRATION_TGT_*)');
  console.log(' COURSE :', courseId, '—', course ? course.title : '(course row missing)');
  console.log(' SHEET  :', file, '(' + rows.length + ' rows)');
  console.log(' MODE   :', fulfill ? 'fulfilling — grants access + sends email' : 'record-only (skip_fulfillment)');
  console.log('══════════════════════════════════════════════════════════════\n');

  // Classify every row before anything is written, so the dry run IS the plan.
  const plan = [];
  for (const r of rows) {
    const amount = amountOverride != null ? Number(amountOverride) : normalizeAmount(r.amountRaw);
    if (amount === null) {
      plan.push({ ...r, action: 'SKIP', reason: 'unparseable amount "' + r.amountRaw + '"' });
      continue;
    }
    if (amount > 0 && !r.paymentId) {
      plan.push({ ...r, amount, action: 'SKIP', reason: 'paid row with no payment id' });
      continue;
    }

    const [user] = await q(
      'SELECT id, name, email, phone FROM users WHERE LOWER(email) = :e LIMIT 1',
      { e: r.email },
    );
    if (!user) {
      plan.push({ ...r, amount, action: 'SKIP', reason: 'no registered user with this email' });
      continue;
    }

    // Idempotency: never add a second order for a course the user already has one for.
    const [existing] = await q(
      `SELECT COUNT(*) AS live_orders FROM orders
        WHERE type = 'course' AND entity_id = :cid AND user_id = :uid AND deleted_at IS NULL`,
      { cid: cidStr, uid: user.id },
    );
    if (Number(existing.live_orders) > 0) {
      plan.push({
        ...r, amount, user, action: 'SKIP',
        reason: 'already has ' + existing.live_orders + ' live order(s) for this course',
      });
      continue;
    }

    // Not a blocker — reported so a sheet aimed at the wrong course is obvious.
    const [enr] = await q(
      `SELECT COUNT(*) AS enrolled FROM batch_enrollments be
         JOIN batches b ON b.id = be.batch_id
        WHERE b.course_id = :cid AND be.user_id = :uid`,
      { cid: Number(courseId), uid: user.id },
    );
    plan.push({ ...r, amount, user, enrolled: Number(enr.enrolled), action: 'CREATE' });
  }

  const toCreate = plan.filter((p) => p.action === 'CREATE');
  const skipped = plan.filter((p) => p.action === 'SKIP');

  console.log('── PLAN ──');
  console.log('  create : ' + toCreate.length);
  console.log('  skip   : ' + skipped.length);
  console.log('  amount : ₹' + toCreate.reduce((s, p) => s + p.amount, 0).toLocaleString('en-IN'));
  const notEnrolled = toCreate.filter((p) => !p.enrolled).length;
  if (notEnrolled) {
    console.log('  NOTE   : ' + notEnrolled + ' row(s) are NOT enrolled in any batch of this course');
  }
  if (skipped.length) {
    console.log('\n── SKIPPED ──');
    console.table(skipped.map((p) => ({ email: p.email, reason: p.reason })));
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to create these orders.');
    await db.close();
    return;
  }
  if (toCreate.length === 0) {
    console.log('\nNothing to create.');
    await db.close();
    return;
  }

  const orderClient = axios.create({
    baseURL: ORDER_SERVICE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json', 'x-internal-api-key': INTERNAL_API_KEY },
  });

  // order-service replies { success, data }. admin-service's orderClient unwraps that in
  // an interceptor; without the same step every row reads as 'no result returned' even
  // though the orders were created — a false failure report that invites a needless re-run.
  orderClient.interceptors.response.use((response) => {
    const b = response.data;
    if (b && typeof b === 'object' && b.success === true && 'data' in b) response.data = b.data;
    return response;
  });

  console.log('\n── CREATING ' + toCreate.length + ' ORDER(S) ──');
  const results = [];
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    const chunk = toCreate.slice(i, i + CHUNK);
    try {
      const { data } = await orderClient.post('/internal/orders/course-bulk', {
        entity_id: cidStr,
        amount: 0,
        status: 'paid',
        // See the header — the sheet's reference is usually already spent, so it is
        // recorded on the order instead of claiming the unique payments slot.
        shared_payment_id: true,
        skip_fulfillment: !fulfill,
        users: chunk.map((p) => ({
          user_id: p.user.id,
          buyer_name: p.user.name || null,
          buyer_email: p.user.email || null,
          buyer_mobile: p.user.phone || null,
          amount: p.amount,
          payment_id: p.paymentId || undefined,
        })),
      });
      const byUser = new Map((Array.isArray(data) ? data : []).map((d) => [String(d.user_id), d]));
      for (const p of chunk) {
        const res = byUser.get(String(p.user.id));
        results.push({
          email: p.email,
          user_id: p.user.id,
          amount: p.amount,
          payment_id: p.paymentId,
          ok: res ? res.ok !== false : false,
          order_id: res && res.order_id ? res.order_id : '',
          error: res ? (res.ok === false ? (res.error || 'order failed') : '') : 'no result returned',
        });
      }
    } catch (err) {
      const reason = (err.response && err.response.data && err.response.data.error) || err.message;
      console.error('  chunk ' + (Math.floor(i / CHUNK) + 1) + ' failed: ' + reason);
      for (const p of chunk) {
        results.push({
          email: p.email, user_id: p.user.id, amount: p.amount,
          payment_id: p.paymentId, ok: false, order_id: '', error: reason,
        });
      }
    }
    console.log('  ' + Math.min(i + CHUNK, toCreate.length) + '/' + toCreate.length + ' processed');
  }

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  console.log('\n── RESULT ──');
  console.log('  created : ' + ok.length);
  console.log('  failed  : ' + failed.length);
  if (failed.length) console.table(failed.map((r) => ({ email: r.email, error: r.error })));

  // A report every run, so a partial failure can be re-driven from the failed rows.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const report = path.join('scripts', 'backfill-orders-' + courseId + '-' + stamp + '.csv');
  fs.writeFileSync(report, [
    'email,user_id,amount,payment_id,ok,order_id,error',
    ...results.map((r) => [
      r.email, r.user_id, r.amount, r.payment_id, r.ok, r.order_id,
      '"' + String(r.error).replace(/"/g, '""') + '"',
    ].join(',')),
  ].join('\n'));
  console.log('\n  report → ' + report);
  console.log('  Re-running is safe: rows that now have an order are skipped.');

  await db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
