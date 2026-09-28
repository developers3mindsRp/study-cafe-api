#!/usr/bin/env node
/**
 * Complete orders that Razorpay has CAPTURED but we still show as pending/failed.
 *
 * How they got stuck (both fixed on 2026-09-28; this repairs what they stranded):
 *  1. Capture refusal. When Razorpay auto-capture wins the race, our capture call is
 *     refused ("order is already paid" / "another payment operation is in progress").
 *     captureRazorpayPayment only recognised "already captured", so completePayment threw
 *     on verify, payment.authorized and payment.captured. order.paid used to hide this —
 *     it passed a synthetic `order_paid_` ref, which skips capture — until the 2026-09-21
 *     payment-id fix gave it the real `pay_...`, so it failed the same way from then on.
 *  2. Superseded Razorpay order. createOrder reuses a pending order and mints a fresh
 *     Razorpay order on every call, overwriting orders.razorpay_order_id. A buyer who paid,
 *     closed the checkout and tapped Pay again left the money on the EARLIER Razorpay order,
 *     whose webhooks then matched no order.
 *
 * For each candidate order it lists every Razorpay order whose receipt is our order_id
 * (plus the current razorpay_order_id), finds a captured payment, and runs the normal
 * completePayment — the same grant + receipt email + Pabbly outbox path as a live
 * checkout. Nothing is deleted; an order with no captured payment is left untouched.
 *
 * DRY RUN BY DEFAULT — nothing is written without --apply.
 *
 * Run on the server from the repo root (reads the root .env like the services do):
 *   node services/order-service/scripts/repair-captured-pending-orders.js
 *   node services/order-service/scripts/repair-captured-pending-orders.js --order ORD_1790485394487_51470f2a
 *   node services/order-service/scripts/repair-captured-pending-orders.js --days 30 --apply
 *
 * Options:
 *   --order <order_id>  check just this order
 *   --days <n>          look back this many days (default 14)
 *   --apply             actually complete the orders
 */
'use strict';

// config/index.js requires PORT; the script never listens on it.
if (!process.env.PORT) process.env.PORT = '0';

const { Op } = require('sequelize');
const { sequelize, Order, Payment } = require('../src/models');
const { completePayment } = require('../src/services/orders.service');
const { getRazorpayConfig, getRazorpayInstance } = require('../src/services/payment.service');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const ONLY_ORDER = argValue('--order');
const DAYS = Number(argValue('--days') || 14);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Razorpay rate-limits bursts ("Too many requests") — pace calls and retry those. */
async function rpCall(fn) {
  for (let attempt = 1; ; attempt += 1) {
    await sleep(300);
    try {
      return await fn();
    } catch (err) {
      const desc = err?.error?.description || err.message || '';
      if (attempt >= 4 || !/too many requests/i.test(desc)) throw err;
      await sleep(2000 * attempt);
    }
  }
}

/** Every Razorpay order minted for this order: receipt search + the current id. */
async function razorpayOrderIdsFor(rp, order) {
  const ids = new Set();
  if (order.razorpay_order_id) ids.add(order.razorpay_order_id);
  try {
    const res = await rpCall(() => rp.orders.all({ receipt: order.order_id, count: 100 }));
    for (const o of res?.items || []) {
      if (o.receipt === order.order_id) ids.add(o.id);
    }
  } catch (err) {
    console.warn(`  ! receipt search failed for ${order.order_id}: ${err?.error?.description || err.message}`);
  }
  return [...ids];
}

async function capturedPaymentFor(rp, rpOrderIds) {
  for (const rpOrderId of rpOrderIds) {
    try {
      const res = await rpCall(() => rp.orders.fetchPayments(rpOrderId));
      const captured = (res?.items || []).find((p) => p.status === 'captured');
      if (captured) return { rpOrderId, payment: captured };
    } catch (err) {
      console.warn(`  ! fetchPayments failed for ${rpOrderId}: ${err?.error?.description || err.message}`);
    }
  }
  return null;
}

/**
 * Why this payment must NOT be used to grant this order — empty when it is safe.
 * Nobody may get access without having paid: the payment has to be captured right
 * now, unrefunded, for exactly this order's amount and currency, on a Razorpay order
 * that was created for this order, and not already recorded against another order.
 */
async function paymentProblems(rp, order, hit) {
  const problems = [];

  let pay;
  let rpOrder;
  try {
    pay = await rpCall(() => rp.payments.fetch(hit.payment.id));
    rpOrder = await rpCall(() => rp.orders.fetch(hit.rpOrderId));
  } catch (err) {
    return [`could not re-read payment/order from Razorpay: ${err?.error?.description || err.message}`];
  }

  if (pay.status !== 'captured') problems.push(`payment status is "${pay.status}", not captured`);
  if (Number(pay.amount_refunded || 0) !== 0 || pay.refund_status) {
    problems.push(`payment has refunds (amount_refunded=${pay.amount_refunded}, refund_status=${pay.refund_status})`);
  }
  if (pay.order_id !== hit.rpOrderId) problems.push(`payment belongs to ${pay.order_id}, not ${hit.rpOrderId}`);
  const expectedPaise = Math.round(Number(order.amount) * 100);
  if (Number(pay.amount) !== expectedPaise) {
    problems.push(`paid ${pay.amount / 100} but the order is for ${order.amount}`);
  }
  if (String(pay.currency || '').toUpperCase() !== String(order.currency || 'INR').toUpperCase()) {
    problems.push(`paid in ${pay.currency}, order is in ${order.currency}`);
  }
  if (rpOrder.receipt !== order.order_id) {
    problems.push(`Razorpay order receipt is "${rpOrder.receipt}", not ${order.order_id}`);
  }
  if (rpOrder.status !== 'paid') problems.push(`Razorpay order status is "${rpOrder.status}", not paid`);

  const linked = await Payment.findOne({
    where: { razorpay_payment_id: pay.id, order_id: { [Op.ne]: order.id } },
  });
  if (linked) problems.push(`payment is already recorded against another order (orders.id ${linked.order_id})`);

  return problems;
}

async function main() {
  // payment.service silently falls back to the RAZORPAY_* test keys in .env when
  // admin-service is unreachable. Against the live database that would report every
  // real payment as missing — refuse instead of producing a wrong answer.
  const cfg = await getRazorpayConfig();
  if (!cfg || !String(cfg.key_id || '').startsWith('rzp_live_')) {
    throw new Error(
      `Refusing to run: Razorpay key is ${cfg ? `"${String(cfg.key_id).slice(0, 12)}…" (not live)` : 'not configured'}. ` +
        'Run this where admin-service is reachable (on the server), so the live keys are used.'
    );
  }
  const rp = await getRazorpayInstance();
  if (!rp) throw new Error('Razorpay is not configured');

  const where = ONLY_ORDER
    ? { order_id: ONLY_ORDER }
    : {
        status: { [Op.in]: ['pending', 'failed'] },
        razorpay_order_id: { [Op.ne]: null },
        created_at: { [Op.gte]: new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000) },
      };
  const orders = await Order.findAll({ where, order: [['id', 'ASC']] });

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${orders.length} candidate order(s)${ONLY_ORDER ? '' : `, last ${DAYS} day(s)`}\n`);

  let found = 0;
  let skipped = 0;
  let completed = 0;
  for (const order of orders) {
    if (order.status === 'paid') {
      console.log(`${order.order_id}: already paid — skipping`);
      continue;
    }
    const rpOrderIds = await razorpayOrderIdsFor(rp, order);
    const hit = await capturedPaymentFor(rp, rpOrderIds);
    if (!hit) {
      if (ONLY_ORDER) console.log(`${order.order_id}: no captured payment on ${rpOrderIds.join(', ') || 'any Razorpay order'}`);
      continue;
    }

    const label =
      `${order.order_id} [${order.status}] user ${order.user_id} — ${hit.payment.id} on ${hit.rpOrderId}` +
      `${hit.rpOrderId !== order.razorpay_order_id ? ' (superseded Razorpay order)' : ''}`;

    // Granting access is irreversible in practice, so every doubt means "leave it for a
    // human". Re-read the payment fresh from Razorpay rather than trusting the list.
    const problems = await paymentProblems(rp, order, hit);
    if (problems.length) {
      skipped += 1;
      console.log(`SKIP ${label}\n  ✗ ${problems.join('\n  ✗ ')}`);
      continue;
    }

    found += 1;
    console.log(`OK   ${label} — captured ₹${hit.payment.amount / 100}, nothing refunded`);

    if (!APPLY) continue;
    try {
      const result = await completePayment(order, hit.payment.id, { source: 'reconcile' });
      console.log(`  → ${JSON.stringify(result)}`);
      if (result && result.verified) completed += 1;
    } catch (err) {
      console.error(`  ✗ completePayment failed: ${err.message}`);
    }
  }

  console.log(
    `\n${found} order(s) passed every check${APPLY ? `, ${completed} completed` : ' — re-run with --apply to complete them'}` +
      (skipped ? `; ${skipped} skipped for manual review (see SKIP lines)` : '')
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
