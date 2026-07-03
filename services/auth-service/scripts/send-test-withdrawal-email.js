#!/usr/bin/env node
'use strict';

/**
 * Send test affiliate withdrawal emails (request / approved / declined).
 *
 * Usage:
 *   node scripts/send-test-withdrawal-email.js shudhanshu.rpa@gmail.com
 *   node scripts/send-test-withdrawal-email.js shudhanshu.rpa@gmail.com --status=approved
 *   node scripts/send-test-withdrawal-email.js shudhanshu.rpa@gmail.com --all
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
process.env.PORT = process.env.PORT || '4001';
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'auth-service';

const { sendWithdrawalEmail } = require('../src/services/email.service');

const STATUSES = ['created', 'approved', 'rejected'];

function samplePayload(to, status) {
  return {
    to,
    name: 'Shudhanshu',
    status,
    requestId: 9001,
    amount: 2500,
    currency: 'INR',
    remarks:
      status === 'rejected'
        ? 'Bank account details could not be verified. Please update your payout information and submit again.'
        : undefined,
  };
}

async function sendOne(to, status) {
  console.log(`Sending withdrawal "${status}" email to ${to}…`);
  const result = await sendWithdrawalEmail(samplePayload(to, status));
  if (!result.sent) {
    throw new Error(`${status}: not sent (${result.reason || 'unknown'})`);
  }
  console.log(`  ✓ ${status} sent`);
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const to = args[0] || 'shudhanshu.rpa@gmail.com';
  const all = process.argv.includes('--all');
  const statusArg = process.argv.find((a) => a.startsWith('--status='));
  const status = statusArg ? statusArg.split('=')[1] : 'created';

  if (all) {
    for (const s of STATUSES) {
      await sendOne(to, s);
    }
    console.log('\nAll withdrawal test emails sent.');
    return;
  }

  if (!STATUSES.includes(status)) {
    console.error(`Invalid --status=${status}. Use: ${STATUSES.join(', ')}`);
    process.exit(1);
  }

  await sendOne(to, status);
  console.log('Withdrawal test email sent successfully.');
}

main().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
