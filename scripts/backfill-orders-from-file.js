#!/usr/bin/env node
/**
 * Backfill course orders from a CSV of (email, payment_id, amount).
 *
 * Use case: users who were allotted a course (enrollment + access already exist)
 * but whose order row was never created (deadlock / order-service down). Because
 * they are already enrolled, the "Allot Course" modal returns "already enrolled"
 * and creates nothing — and it can only apply ONE payment id to the whole batch,
 * whereas this reconciliation needs a per-user payment id + amount.
 *
 * For each CSV row this creates the missing paid order + its captured payment,
 * using that user's own payment id and amount.
 *
 * SAFE BY DESIGN:
 *   - Dry-run by default. Pass --apply to write.
 *   - Idempotent: skips any user who already has a course order for this course.
 *   - Does NOT modify user_courses (access is already correct).
 *   - Pure DB writes — no outbox events, so it sends NO emails.
 *   - Order created_at = the user's original enrollment time (truthful reporting).
 *   - Flags rows whose payment id is not a single clean razorpay id (pay_xxx) so
 *     you can review them before applying.
 *
 * CSV: header row required. Column names are matched flexibly:
 *   email        <- email | email address | e-mail
 *   payment_id   <- payment_id | payment id | razorpay_payment_id | payment
 *   amount       <- amount | amount_paid | amount paid | payment_amount | price | paid
 *
 * Usage:
 *   node scripts/backfill-orders-from-file.js --file="./april 5 sheet.csv" --course=424939 --batch=215
 *   node scripts/backfill-orders-from-file.js --file="./april 5 sheet.csv" --course=424939 --batch=215 --apply
 *   (optional) --gateway=razorpay|admin   (default: inferred from payment id)
 *   (optional) --skip-flagged              (do not create orders for flagged rows)
 */

const fs = require('fs');
const path = require('path');
// Resolves .env (local) or .env.production (APP_ENV=production / ENV_FILE=…),
// independent of the directory the script is invoked from.
require('../shared/env');
const mysql = require('mysql2/promise');

// ---- args ----------------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [a, true];
  })
);
const FILE = args.file;
const COURSE_ID = String(args.course || '').trim();
const BATCH_ID = Number(args.batch);
const GATEWAY_OVERRIDE = args.gateway ? String(args.gateway).trim() : null;
const APPLY = Boolean(args.apply);
const SKIP_FLAGGED = Boolean(args['skip-flagged']);

if (!FILE || !COURSE_ID || !Number.isFinite(BATCH_ID)) {
  console.error('Usage: node scripts/backfill-orders-from-file.js --file=<csv> --course=<courseId> --batch=<batchId> [--gateway=razorpay|admin] [--skip-flagged] [--apply]');
  process.exit(1);
}

// ---- quote-aware CSV parsing --------------------------------------------
function splitRowQuoted(line, delim) {
  const out = [];
  let field = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

const CLEAN_RAZORPAY = /^pay_[A-Za-z0-9]+$/;

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = splitRowQuoted(lines[0], delim).map((h) => h.toLowerCase());
  const find = (names) => headers.findIndex((h) => names.includes(h));
  const iEmail = find(['email', 'email address', 'e-mail']);
  const iPay = find(['payment_id', 'payment id', 'razorpay_payment_id', 'payment']);
  const iAmt = find(['amount', 'amount_paid', 'amount paid', 'payment_amount', 'price', 'paid']);
  if (iEmail === -1) throw new Error('CSV has no recognizable "email" column');
  return lines.slice(1).map((line) => {
    const cols = splitRowQuoted(line, delim);
    const payment_id = iPay === -1 ? '' : (cols[iPay] || '').trim();
    const amtRaw = iAmt === -1 ? '' : (cols[iAmt] || '');
    let flag = null;
    if (!payment_id) flag = 'no_payment_id';
    else if (/[,;]/.test(payment_id)) flag = 'multiple_ids';
    else if (payment_id.includes('@')) flag = 'looks_like_email';
    else if (!CLEAN_RAZORPAY.test(payment_id)) flag = 'non_razorpay_ref';
    return {
      email: (cols[iEmail] || '').toLowerCase(),
      payment_id,
      amount: Number(String(amtRaw).replace(/[^0-9.]/g, '')) || 0,
      flag,
    };
  }).filter((r) => r.email);
}

function orderId(userId) {
  return `ORD_${Date.now()}_bf${BATCH_ID}_${userId}`;
}

(async () => {
  const rows = parseCsv(fs.readFileSync(path.resolve(FILE), 'utf8'));
  const flagged = rows.filter((r) => r.flag);
  console.log(`Parsed ${rows.length} rows from ${FILE}`);
  console.log(`Target: course=${COURSE_ID} batch=${BATCH_ID}  mode=${APPLY ? 'APPLY (writing)' : 'DRY-RUN (no writes)'}`);
  if (flagged.length) console.log(`⚠  ${flagged.length} row(s) have non-standard payment ids (see FLAGGED list below)${SKIP_FLAGGED ? ' — will be SKIPPED' : ''}\n`);
  else console.log('');

  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
  });

  const summary = { created: 0, skipped_flagged: 0, already_has_order: 0, not_enrolled: 0, user_not_found: 0, error: 0 };

  for (const r of rows) {
    try {
      if (r.flag && SKIP_FLAGGED) { summary.skipped_flagged++; console.log(`  skip_flagged    ${r.email}  (${r.flag})`); continue; }

      const [users] = await db.execute('SELECT id, name, email, phone FROM users WHERE email = ? LIMIT 1', [r.email]);
      if (!users.length) { summary.user_not_found++; console.log(`  user_not_found  ${r.email}`); continue; }
      const u = users[0];

      const [enr] = await db.execute('SELECT enrolled_at FROM batch_enrollments WHERE batch_id = ? AND user_id = ? LIMIT 1', [BATCH_ID, u.id]);
      if (!enr.length) { summary.not_enrolled++; console.log(`  not_enrolled    ${r.email} (user ${u.id})`); continue; }
      const enrolledAt = enr[0].enrolled_at || new Date();

      const [existing] = await db.execute(
        "SELECT id FROM orders WHERE user_id = ? AND type = 'course' AND entity_id = ? AND deleted_at IS NULL LIMIT 1",
        [u.id, COURSE_ID]
      );
      if (existing.length) { summary.already_has_order++; console.log(`  already_order   ${r.email} (order id ${existing[0].id})`); continue; }

      const isRp = GATEWAY_OVERRIDE ? GATEWAY_OVERRIDE === 'razorpay' : CLEAN_RAZORPAY.test(r.payment_id);
      const gateway = GATEWAY_OVERRIDE || (isRp ? 'razorpay' : 'admin');
      const oid = orderId(u.id);
      const rpPaymentId = isRp ? r.payment_id : null;
      const payRef = r.payment_id || `manual:${oid}`;
      const flagNote = r.flag ? `  ⚠ ${r.flag}` : '';

      if (!APPLY) {
        summary.created++;
        console.log(`  WOULD CREATE    ${r.email}  amount=${r.amount}  gateway=${gateway}  payment_id=${r.payment_id || '(none)'}${flagNote}`);
        continue;
      }

      await db.beginTransaction();
      try {
        const [ins] = await db.execute(
          `INSERT INTO orders
             (order_id, user_id, type, entity_id, batch_id, amount, currency,
              buyer_name, buyer_email, buyer_mobile, rp_payment_id, coupon_discount,
              original_amount, status, gateway, created_at)
           VALUES (?, ?, 'course', ?, ?, ?, 'INR', ?, ?, ?, ?, 0.00, ?, 'paid', ?, ?)`,
          [oid, u.id, COURSE_ID, BATCH_ID, r.amount, u.name, u.email, u.phone || null, rpPaymentId, r.amount, gateway, enrolledAt]
        );
        await db.execute(
          `INSERT INTO payments (order_id, razorpay_payment_id, amount, status, source)
           VALUES (?, ?, ?, 'captured', ?)`,
          [ins.insertId, payRef, r.amount, gateway === 'razorpay' ? 'razorpay' : 'manual']
        );
        await db.commit();
        summary.created++;
        console.log(`  CREATED         ${r.email}  order=${oid}  amount=${r.amount}  payment_id=${r.payment_id || '(manual)'}${flagNote}`);
      } catch (e) {
        await db.rollback();
        throw e;
      }
    } catch (e) {
      summary.error++;
      console.log(`  ERROR           ${r.email}  ${e.message}`);
    }
  }

  await db.end();

  if (flagged.length) {
    console.log('\n==== FLAGGED ROWS (review these payment ids) ====');
    for (const f of flagged) console.log(`  ${f.flag.padEnd(18)} ${f.email}  amount=${f.amount}  payment_id="${f.payment_id}"`);
  }
  console.log('\n==== summary ====');
  console.log(summary);
  if (!APPLY) console.log('\nDry-run only. Re-run with --apply to write these orders.');
})().catch((e) => { console.error(e); process.exit(1); });
