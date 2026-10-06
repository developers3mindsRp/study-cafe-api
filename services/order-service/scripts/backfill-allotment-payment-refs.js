#!/usr/bin/env node
/**
 * Backfill the real payment ID onto admin-allotted orders that show a `manual:` placeholder.
 *
 * How they got stranded (fixed 2026-10-06; this repairs what is already stored): an admin
 * allotting a membership and its courses together typed the payment ID once, on the
 * membership. Each course was booked as its own order with no payment ID, so it got a
 * `manual:<orderId>` capture ref — which the admin Orders list shows as the payment ID.
 * Typing the same ID on the course rows didn't help either: `payments` is UNIQUE on the
 * reference, so that course order was rejected and the learner was enrolled with no order.
 *
 * For each paid order whose payment ID still resolves to a `manual:` placeholder, it looks
 * for other paid orders of the SAME user placed within --window minutes that carry a real
 * payment ID, and classifies:
 *   ready   exactly one such ID, it is a Razorpay `pay_...` id, and this order is ₹0
 *           (included in the bundle). --apply writes it to orders.rp_payment_id.
 *   review  several candidate IDs, a non-Razorpay reference (bank text), or this order has
 *           its own amount (may be a separate payment). Never written — check each one and
 *           fix it in Order Edit, which now accepts a payment ID shared with another order.
 * Orders with no nearby sibling carrying a real ID are counted and left alone.
 *
 * Writes only orders.rp_payment_id — the shared-settlement column the admin views, search
 * and the buyer receipt already read — and only where it is NULL. Payment rows are never
 * touched and nothing is deleted.
 *
 * DRY RUN BY DEFAULT — nothing is written without --apply.
 *
 * Run on the server from the repo root (reads the root .env like the services do):
 *   node services/order-service/scripts/backfill-allotment-payment-refs.js
 *   node services/order-service/scripts/backfill-allotment-payment-refs.js --csv /tmp/payment-refs.csv
 *   node services/order-service/scripts/backfill-allotment-payment-refs.js --apply
 *
 * Options:
 *   --since <YYYY-MM-DD>  only orders created on/after this date (default 2026-07-01)
 *   --window <minutes>    how far apart the sibling order may be (default 30)
 *   --order <order_id>    check just this order
 *   --csv <file>          also write every ready/review row to a CSV
 *   --apply               write the `ready` rows
 */
'use strict';

// config/index.js requires PORT; the script never listens on it.
if (!process.env.PORT) process.env.PORT = '0';

const fs = require('fs');
const { Op } = require('sequelize');
const { sequelize, Order, Payment } = require('../src/models');
const { resolveAdminPaymentId, isSyntheticPaymentRef } = require('../src/services/orders.service');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const SINCE = argValue('--since') || '2026-07-01';
const WINDOW_MS = Number(argValue('--window') || 30) * 60 * 1000;
const ONLY_ORDER = argValue('--order');
const CSV_PATH = argValue('--csv');

const PAID = ['paid', 'completed'];
const RAZORPAY_PAYMENT_ID = /^pay_[A-Za-z0-9]{8,}$/;

/** Every payment row per order pk, newest first — the order resolveAdminPaymentId expects. */
async function paymentsByOrder(orderPks) {
  const map = new Map();
  if (orderPks.length === 0) return map;
  const rows = await Payment.findAll({
    where: { order_id: { [Op.in]: orderPks } },
    order: [['id', 'DESC']],
    raw: true,
  });
  for (const p of rows) {
    if (!map.has(p.order_id)) map.set(p.order_id, []);
    map.get(p.order_id).push(p);
  }
  return map;
}

/** The payment ID an admin sees for this order, or null when it is only a placeholder. */
function realPaymentId(order, payments) {
  const ref = resolveAdminPaymentId(order, payments || []);
  return ref && !isSyntheticPaymentRef(String(ref)) ? String(ref).trim() : null;
}

function classify(candidate, refs) {
  if (refs.length > 1) return { status: 'review', reason: 'several payment IDs nearby — pick the right one' };
  const [ref] = refs;
  if (!RAZORPAY_PAYMENT_ID.test(ref)) return { status: 'review', reason: 'not a Razorpay pay_ id (bank/other reference)' };
  if (Number(candidate.amount) > 0) return { status: 'review', reason: 'order has its own amount — may be a separate payment' };
  return { status: 'ready', reason: '' };
}

function toCsv(rows) {
  const cols = ['status', 'order_id', 'type', 'entity_id', 'user_id', 'amount', 'created_at', 'payment_id', 'from_orders', 'reason'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

async function main() {
  const where = { status: { [Op.in]: PAID }, rp_payment_id: null, user_id: { [Op.ne]: null } };
  if (ONLY_ORDER) where.order_id = ONLY_ORDER;
  else where.created_at = { [Op.gte]: new Date(`${SINCE}T00:00:00Z`) };

  const orders = await Order.findAll({ where, order: [['id', 'ASC']], raw: true });
  const orderPayments = await paymentsByOrder(orders.map((o) => o.id));

  // Orders whose displayed payment ID is still a `manual:` placeholder.
  const candidates = orders.filter((o) => {
    const rows = orderPayments.get(o.id) || [];
    return (
      rows.some((p) => String(p.razorpay_payment_id).startsWith('manual:')) &&
      realPaymentId(o, rows) === null
    );
  });

  if (candidates.length === 0) {
    console.log('No paid orders showing a manual: placeholder in range.');
    return;
  }

  // Every paid order of those users near the candidates, with the payment ID each shows.
  const userIds = [...new Set(candidates.map((o) => o.user_id))];
  const earliest = Math.min(...candidates.map((o) => new Date(o.created_at).getTime()));
  const siblings = await Order.findAll({
    where: {
      user_id: { [Op.in]: userIds },
      status: { [Op.in]: PAID },
      created_at: { [Op.gte]: new Date(earliest - WINDOW_MS) },
    },
    raw: true,
  });
  const siblingPayments = await paymentsByOrder(siblings.map((o) => o.id));
  const siblingsByUser = new Map();
  for (const s of siblings) {
    const ref = realPaymentId(s, siblingPayments.get(s.id));
    if (!ref) continue;
    if (!siblingsByUser.has(s.user_id)) siblingsByUser.set(s.user_id, []);
    siblingsByUser.get(s.user_id).push({ ...s, ref });
  }

  const results = [];
  let noSibling = 0;
  for (const c of candidates) {
    const at = new Date(c.created_at).getTime();
    const near = (siblingsByUser.get(c.user_id) || []).filter(
      (s) => s.id !== c.id && Math.abs(new Date(s.created_at).getTime() - at) <= WINDOW_MS
    );
    const refs = [...new Set(near.map((s) => s.ref))];
    if (refs.length === 0) {
      noSibling += 1;
      continue;
    }
    const { status, reason } = classify(c, refs);
    results.push({
      id: c.id,
      status,
      order_id: c.order_id,
      type: c.type,
      entity_id: c.entity_id,
      user_id: c.user_id,
      amount: c.amount,
      created_at: new Date(c.created_at).toISOString().slice(0, 16).replace('T', ' '),
      payment_id: refs.join(' | '),
      from_orders: [...new Set(near.map((s) => s.order_id))].join(' | '),
      reason,
    });
  }

  const ready = results.filter((r) => r.status === 'ready');
  const review = results.filter((r) => r.status === 'review');
  const show = (rows) =>
    console.table(rows.map(({ id, from_orders, ...r }) => r));

  console.log(`\nREADY — will get the payment ID (${ready.length}):`);
  if (ready.length) show(ready);
  console.log(`\nREVIEW — not written, check and fix in Order Edit (${review.length}):`);
  if (review.length) show(review);
  console.log(
    `\n${candidates.length} orders show a manual: placeholder; ${ready.length} ready, ${review.length} to review, ` +
      `${noSibling} with no nearby order carrying a payment ID (left alone).`
  );

  if (CSV_PATH) {
    fs.writeFileSync(CSV_PATH, toCsv(results));
    console.log(`CSV written to ${CSV_PATH}`);
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to write the READY rows.');
    return;
  }

  let written = 0;
  for (const r of ready) {
    const [n] = await Order.update(
      { rp_payment_id: r.payment_id },
      { where: { id: r.id, rp_payment_id: null } }
    );
    written += n;
  }
  console.log(`\nApplied: rp_payment_id set on ${written} of ${ready.length} READY orders.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
