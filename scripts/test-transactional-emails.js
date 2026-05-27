/**
 * Send sample transactional emails (no API / DB required).
 * Usage: node scripts/test-transactional-emails.js [recipient@email.com]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const TO = process.argv[2] || 'shudhanshu@mailinator.com';

async function main() {
  console.log(`Sending test emails to ${TO}...\n`);

  const authEmail = require('../services/auth-service/src/services/email.service');
  const { sendContactInquiryEmails } = require('../services/platform-service/src/services/contactInquiryEmail.service');

  const inquiry = {
    id: 99999,
    first_name: 'Shudhanshu',
    last_name: 'Test',
    email: TO,
    mobile_number: '9999988888',
    country_code: 'IN',
    subject: 'Test enquiry from script',
    message: 'This is a test contact form submission to verify admin and user confirmation emails.',
    status: 'new',
  };

  console.log('1. Contact — admin notification (to CONTACT_ADMIN_EMAIL)...');
  const contact = await sendContactInquiryEmails(inquiry);
  console.log('   ', JSON.stringify(contact));

  console.log('2. Password changed confirmation...');
  const pwd = await authEmail.sendPasswordChangedEmail({ to: TO, name: 'Shudhanshu' });
  console.log('   ', JSON.stringify(pwd));

  console.log('3. Withdrawal — request created...');
  const w1 = await authEmail.sendWithdrawalEmail({
    to: TO,
    name: 'Shudhanshu',
    status: 'created',
    requestId: 1001,
    amount: 2500,
    currency: 'INR',
  });
  console.log('   ', JSON.stringify(w1));

  console.log('4. Withdrawal — approved...');
  const w2 = await authEmail.sendWithdrawalEmail({
    to: TO,
    name: 'Shudhanshu',
    status: 'approved',
    requestId: 1001,
    amount: 2500,
    currency: 'INR',
  });
  console.log('   ', JSON.stringify(w2));

  console.log('5. Withdrawal — rejected (with remarks)...');
  const w3 = await authEmail.sendWithdrawalEmail({
    to: TO,
    name: 'Shudhanshu',
    status: 'rejected',
    requestId: 1002,
    amount: 1500,
    currency: 'INR',
    remarks: 'Bank details could not be verified. Please update your profile and submit again.',
  });
  console.log('   ', JSON.stringify(w3));

  console.log('\nDone. Check inbox:', TO);
  console.log('Admin contact alert goes to:', process.env.CONTACT_ADMIN_EMAIL || 'contact@studycafe.in');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
