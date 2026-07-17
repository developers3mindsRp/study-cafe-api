#!/usr/bin/env node
'use strict';

/**
 * Send a test "access granted" email using courseAccessEmail.js templates.
 * Sent instead of the payment email when access is granted via an admin-created order.
 *
 * Usage:
 *   node scripts/send-test-course-access-email.js shudhanshu.rpa@gmail.com
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
process.env.PORT = process.env.PORT || '4001';
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'auth-service';

const { sendCourseAccessEmail } = require('../src/services/email.service');

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const to = args[0] || 'shudhanshu.rpa@gmail.com';

  const payload = {
    to,
    orderId: 'SC-TEST-ACCESS-001',
    type: 'course',
    itemName: 'Join StudyCafe Ultimate Membership Plan',
    buyerName: 'Shudhanshu',
  };

  console.log(`Sending course access test email to ${to}…`);
  const result = await sendCourseAccessEmail(payload);

  if (!result.sent) {
    console.error('Email not sent:', result.reason || 'unknown');
    process.exit(1);
  }

  console.log('Test course access email sent successfully.');
}

main().catch((err) => {
  console.error('Failed to send test course access email:', err.message || err);
  process.exit(1);
});
