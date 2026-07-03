#!/usr/bin/env node
'use strict';

/**
 * Send a test payment email using paymentEmail.js templates.
 *
 * Usage:
 *   node scripts/send-test-payment-email.js shudhanshu.rpa@gmail.com
 *   node scripts/send-test-payment-email.js shudhanshu.rpa@gmail.com --failed
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
process.env.PORT = process.env.PORT || '4001';
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'auth-service';

const { sendPaymentEmail } = require('../src/services/email.service');

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const failed = process.argv.includes('--failed');
  const to = args[0] || 'shudhanshu.rpa@gmail.com';

  const payload = failed
    ? {
        to,
        status: 'failed',
        orderId: 'SC-TEST-FAIL-001',
        type: 'course',
        itemName: 'Join StudyCafe Ultimate Membership Plan',
        amount: 4999,
        currency: 'INR',
        buyerName: 'Shudhanshu',
        originalAmount: 5999,
        couponCode: 'TEST10',
        couponDiscount: 1000,
        failReason: 'Payment was declined by the bank. Please try another method.',
      }
    : {
        to,
        status: 'success',
        orderId: 'SC-TEST-OK-001',
        type: 'course',
        itemName: 'Join StudyCafe Ultimate Membership Plan',
        amount: 4999,
        currency: 'INR',
        buyerName: 'Shudhanshu',
        originalAmount: 5999,
        couponCode: 'TEST10',
        couponDiscount: 1000,
        paymentId: 'pay_TEST1234567890',
      };

  console.log(`Sending ${payload.status} payment test email to ${to}…`);
  const result = await sendPaymentEmail(payload);

  if (!result.sent) {
    console.error('Email not sent:', result.reason || 'unknown');
    process.exit(1);
  }

  console.log('Test payment email sent successfully.');
}

main().catch((err) => {
  console.error('Failed to send test payment email:', err.message || err);
  process.exit(1);
});
