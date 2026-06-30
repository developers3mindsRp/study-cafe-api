#!/usr/bin/env node
'use strict';

/**
 * Inspect a payment_gateways row and verify Razorpay test vs live mode.
 *
 * Usage:
 *   node scripts/test-payment-gateway.js --id=7
 *   node scripts/test-payment-gateway.js --id=7 --expect=live
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
process.env.PORT = process.env.PORT || '4004';
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'admin-service';

const mysql = require('mysql2/promise');
const { mysqlConfig } = require('../shared/env');
const { decryptSecret } = require('../shared/secretCrypto');
const { detectRazorpayKeyMode, razorpayKeyModeLabel } = require('../shared/razorpayKeyMode');

function parseArgs(argv) {
  const out = { id: null, expect: null };
  for (const arg of argv) {
    if (arg.startsWith('--id=')) out.id = Number(arg.slice(5));
    if (arg.startsWith('--expect=')) out.expect = String(arg.slice(9)).toLowerCase();
  }
  return out;
}

function maskSecret(value) {
  if (!value) return '(empty)';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.isAssertion = true;
    throw err;
  }
}

async function loadGatewayRow(id) {
  const conn = await mysql.createConnection(mysqlConfig());
  try {
    const [rows] = await conn.query('SELECT * FROM payment_gateways WHERE id = ?', [id]);
    return rows[0] || null;
  } finally {
    await conn.end();
  }
}

async function loadOrderServiceConfig() {
  process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'order-service';
  const { getRazorpayConfig, clearRazorpayConfigCache } = require('../services/order-service/src/services/payment.service');
  clearRazorpayConfigCache();
  return getRazorpayConfig();
}

async function loadActivePaymentConfig() {
  const paymentConfigService = require('../services/admin-service/src/services/paymentConfig.service');
  const { sequelize } = require('../services/admin-service/src/models');
  await sequelize.authenticate();
  try {
    return await paymentConfigService.getPaymentConfig();
  } finally {
    await sequelize.close();
  }
}

async function main() {
  const { id, expect } = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(id) || id <= 0) {
    console.error('Usage: node scripts/test-payment-gateway.js --id=7 [--expect=live|test]');
    process.exit(1);
  }

  const row = await loadGatewayRow(id);
  assert(row, `Payment gateway #${id} not found`);

  const keyId = decryptSecret(row.key_id || '', { soft: true });
  const keySecret = decryptSecret(row.key_secret || '', { soft: true });
  const webhookSecret = row.webhook_secret
    ? decryptSecret(row.webhook_secret, { soft: true })
    : '';

  const storedMode = detectRazorpayKeyMode(keyId);
  const runtimeConfig = await loadActivePaymentConfig();
  const runtimeMode = detectRazorpayKeyMode(runtimeConfig.key_id);
  const orderServiceConfig = await loadOrderServiceConfig();
  const orderMode = detectRazorpayKeyMode(orderServiceConfig?.key_id);
  const isActive = Number(row.is_active) === 1;

  console.log('── Payment gateway row ──');
  console.log(`id:              ${row.id}`);
  console.log(`name:            ${row.name}`);
  console.log(`is_active:       ${isActive ? 'yes' : 'no'}`);
  console.log(`stored key_id:   ${keyId || '(locked — cannot decrypt)'}`);
  console.log(`stored mode:     ${razorpayKeyModeLabel(storedMode)} (${storedMode})`);
  console.log(`key_secret:      ${keySecret ? maskSecret(keySecret) : '(locked / missing)'}`);
  console.log(`webhook_secret:  ${webhookSecret ? maskSecret(webhookSecret) : row.webhook_secret ? '(locked — re-save in admin)' : '(not set)'}`);

  console.log('\n── Runtime payment config (order-service uses this) ──');
  console.log(`active key_id:   ${runtimeConfig.key_id || '(empty)'}`);
  console.log(`active mode:     ${razorpayKeyModeLabel(runtimeMode)} (${runtimeMode})`);
  console.log(`key_secret:      ${runtimeConfig.key_secret ? maskSecret(runtimeConfig.key_secret) : '(empty)'}`);

  console.log('\n── Order-service checkout key (what Razorpay modal receives) ──');
  console.log(`checkout key_id: ${orderServiceConfig?.key_id || '(empty)'}`);
  console.log(`checkout mode:   ${razorpayKeyModeLabel(orderMode)} (${orderMode})`);

  if (process.env.RAZORPAY_KEY_ID) {
    const envMode = detectRazorpayKeyMode(process.env.RAZORPAY_KEY_ID);
    console.log(`\n.env RAZORPAY_KEY_ID: ${process.env.RAZORPAY_KEY_ID} (${razorpayKeyModeLabel(envMode)})`);
    if (envMode === 'test' && isActive && storedMode === 'live' && orderMode === 'test') {
      console.log('⚠ .env test keys are overriding live admin gateway in order-service.');
    }
  }

  if (isActive && storedMode !== 'missing' && runtimeMode !== storedMode) {
    console.log('\n⚠ MISMATCH: Active gateway row mode does not match runtime payment config.');
    console.log('  Payments will use the runtime config key, not necessarily this row.');
  } else if (isActive && storedMode !== 'missing' && runtimeMode === storedMode) {
    console.log('\n✓ Active gateway matches runtime payment config mode.');
  }

  if (expect) {
    assert(
      storedMode === expect,
      `Expected stored mode "${expect}" but got "${storedMode}" for gateway #${id}`
    );
    if (isActive) {
      assert(
        runtimeMode === expect,
        `Gateway #${id} is active but runtime config mode is "${runtimeMode}", expected "${expect}"`
      );
      assert(
        orderMode === expect,
        `Order-service checkout key mode is "${orderMode}", expected "${expect}"`
      );
    }
  }

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(`\n✗ ${err.message || err}`);
  process.exit(1);
});
