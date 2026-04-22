#!/usr/bin/env node
/**
 * Nodemailer test script.
 *
 * Usage:
 *   node scripts/test-nodemailer.js <to-email>
 *   node scripts/test-nodemailer.js <to-email> --ethereal
 *
 * Env vars (real SMTP mode):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * --ethereal flag creates a disposable Ethereal test account — no real mail is
 * delivered; a preview URL is printed instead. Useful when you don't have
 * real SMTP credentials handy.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const nodemailer = require('nodemailer');

async function buildTransporter(useEthereal) {
  if (useEthereal) {
    const testAccount = await nodemailer.createTestAccount();
    console.log('[ethereal] created test account:', testAccount.user);
    return {
      transporter: nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: { user: testAccount.user, pass: testAccount.pass },
      }),
      from: `"StudyCafe Test" <${testAccount.user}>`,
      isEthereal: true,
    };
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'no-reply@studycafe.local';

  if (!host) {
    throw new Error('SMTP_HOST not set. Set SMTP_* env vars or pass --ethereal.');
  }

  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    }),
    from,
    isEthereal: false,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const useEthereal = args.includes('--ethereal');
  const to = args.find((a) => !a.startsWith('--'));

  if (!to) {
    console.error('Usage: node scripts/test-nodemailer.js <to-email> [--ethereal]');
    process.exit(1);
  }

  const { transporter, from, isEthereal } = await buildTransporter(useEthereal);

  console.log('[verify] checking SMTP connection...');
  await transporter.verify();
  console.log('[verify] OK');

  const info = await transporter.sendMail({
    from,
    to,
    subject: `StudyCafe nodemailer test — ${new Date().toISOString()}`,
    text: 'If you can read this, nodemailer is wired up correctly.',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#111">StudyCafe — Nodemailer Test</h2>
        <p>If you can read this, nodemailer is wired up correctly.</p>
        <p style="color:#6b7280;font-size:12px">Sent at ${new Date().toISOString()}</p>
      </div>
    `,
  });

  console.log('[send] messageId:', info.messageId);
  if (isEthereal) {
    console.log('[send] preview:', nodemailer.getTestMessageUrl(info));
  }
}

main().catch((err) => {
  console.error('[error]', err.message);
  process.exit(1);
});
