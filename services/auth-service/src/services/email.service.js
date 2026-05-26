const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../../../../shared');
const { buildOtpMailboxHtml, buildOtpPlainText } = require('../emailTemplates/otpMailbox');
const {
  buildPasswordResetMailboxHtml,
  buildPasswordResetPlainText,
} = require('../emailTemplates/passwordResetMailbox');
const { buildPaymentEmailHtml, buildPaymentEmailPlainText } = require('../emailTemplates/paymentEmail');
const { buildWelcomeEmailHtml, buildWelcomeEmailPlainText } = require('../emailTemplates/welcomeEmail');
const {
  buildPasswordChangedEmailHtml,
  buildPasswordChangedEmailPlainText,
} = require('../emailTemplates/passwordChangedEmail');
const {
  buildWithdrawalEmailHtml,
  buildWithdrawalEmailPlainText,
} = require('../emailTemplates/withdrawalEmail');

let transporterPromise;

function isSmtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user);
}

async function getTransporter() {
  if (!isSmtpConfigured()) return null;
  if (!transporterPromise) {
    const port = config.smtp.port;
    /** Implicit TLS only on 465; otherwise STARTTLS when requireTLS applies. */
    const secure = port === 465 || config.smtp.secure === true;
    const useStartTls = !secure;

    transporterPromise = Promise.resolve(
      nodemailer.createTransport({
        host: config.smtp.host,
        port,
        secure,
        requireTLS: useStartTls,
        auth: {
          user: config.smtp.user,
          pass: config.smtp.pass,
        },
      })
    );
  }
  return transporterPromise;
}

async function sendOtpEmail({ to, otp, purpose }) {
  const subject =
    purpose === 'login'
      ? 'Your StudyCafe sign-in code'
      : 'Verify your StudyCafe email';
  const ttlMinutes = Math.max(1, Math.round(config.otpTtlSeconds / 60));
  const templateOpts = {
    otp,
    purpose: purpose === 'login' ? 'login' : 'signup',
    siteUrl: config.publicSiteUrl,
    ttlMinutes,
  };
  const text = buildOtpPlainText(templateOpts);
  const html = buildOtpMailboxHtml(templateOpts);

  if (!isSmtpConfigured()) {
    logger.warn('[email] SMTP not configured — OTP not delivered by email', { to, purpose });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = await getTransporter();
  if (!transport) {
    logger.warn('[email] No transporter', { to, purpose });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await transport.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html,
    });
    logger.info('[email] OTP sent', { to, purpose, messageId: info.messageId });
    return { sent: true };
  } catch (err) {
    logger.error('[email] sendMail failed', {
      to,
      purpose,
      err: err?.message || String(err),
      code: err?.code,
      response: err?.response,
      responseCode: err?.responseCode,
    });
    throw err;
  }
}

async function sendPasswordResetEmail({ to, resetUrl, ttlMinutes }) {
  const subject = 'Reset your StudyCafe password';
  const text = buildPasswordResetPlainText({ resetUrl, siteUrl: config.publicSiteUrl, ttlMinutes });
  const html = buildPasswordResetMailboxHtml({ resetUrl, siteUrl: config.publicSiteUrl, ttlMinutes });

  if (!isSmtpConfigured()) {
    logger.warn('[email] SMTP not configured — password reset not delivered by email', { to });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = await getTransporter();
  if (!transport) {
    logger.warn('[email] No transporter', { to });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await transport.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html,
    });
    logger.info('[email] Password reset sent', { to, messageId: info.messageId });
    return { sent: true };
  } catch (err) {
    logger.error('[email] sendMail failed (password reset)', {
      to,
      err: err?.message || String(err),
      code: err?.code,
      response: err?.response,
      responseCode: err?.responseCode,
    });
    throw err;
  }
}

/**
 * Send a payment success or failure email.
 * @param {object} opts
 * @param {string} opts.to          — recipient email
 * @param {'success'|'failed'} opts.status
 * @param {string} opts.orderId
 * @param {'course'|'membership'|'payment_link'} opts.type
 * @param {string} [opts.itemName]
 * @param {number} opts.amount
 * @param {string} [opts.currency]
 * @param {string} [opts.buyerName]
 * @param {string} [opts.couponCode]
 * @param {number} [opts.couponDiscount]
 * @param {number} [opts.originalAmount]
 * @param {string} [opts.paymentId]
 * @param {string} [opts.failReason]
 */
async function sendPaymentEmail(opts) {
  const { to, status } = opts;
  const isSuccess = status === 'success';
  const subject = isSuccess
    ? `Payment Confirmed — Order ${opts.orderId}`
    : `Payment Failed — Order ${opts.orderId}`;

  const templateOpts = { ...opts, siteUrl: config.publicSiteUrl };
  const text = buildPaymentEmailPlainText(templateOpts);
  const html = buildPaymentEmailHtml(templateOpts);

  if (!isSmtpConfigured()) {
    logger.warn('[email] SMTP not configured — payment email not sent', { to, status });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = await getTransporter();
  if (!transport) {
    logger.warn('[email] No transporter — payment email not sent', { to, status });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await transport.sendMail({
      from: config.smtp.from,
      to,
      subject,
      text,
      html,
    });
    logger.info('[email] Payment email sent', { to, status, orderId: opts.orderId, messageId: info.messageId });
    return { sent: true };
  } catch (err) {
    logger.error('[email] Payment email sendMail failed', {
      to,
      status,
      orderId: opts.orderId,
      err: err?.message || String(err),
      code: err?.code,
    });
    throw err;
  }
}

/**
 * Send a welcome email on successful registration.
 * @param {object} opts
 * @param {string} opts.to    — recipient email
 * @param {string} opts.name  — user's display name
 */
async function sendWelcomeEmail({ to, name }) {
  const subject = 'Welcome to Study Cafe!';
  const templateOpts = { name, email: to, siteUrl: config.publicSiteUrl };
  const text = buildWelcomeEmailPlainText(templateOpts);
  const html = buildWelcomeEmailHtml(templateOpts);

  if (!isSmtpConfigured()) {
    logger.warn('[email] SMTP not configured — welcome email not sent', { to });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = await getTransporter();
  if (!transport) {
    logger.warn('[email] No transporter — welcome email not sent', { to });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
    logger.info('[email] Welcome email sent', { to, messageId: info.messageId });
    return { sent: true };
  } catch (err) {
    logger.error('[email] Welcome email sendMail failed', {
      to,
      err: err?.message || String(err),
      code: err?.code,
    });
    throw err;
  }
}

/**
 * Confirm password change to the account holder.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.name]
 */
async function sendPasswordChangedEmail({ to, name }) {
  const subject = 'Your Study Cafe password was changed';
  const templateOpts = { name, email: to, siteUrl: config.publicSiteUrl };
  const text = buildPasswordChangedEmailPlainText(templateOpts);
  const html = buildPasswordChangedEmailHtml(templateOpts);

  if (!isSmtpConfigured()) {
    logger.warn('[email] SMTP not configured — password-changed email not sent', { to });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = await getTransporter();
  if (!transport) {
    logger.warn('[email] No transporter — password-changed email not sent', { to });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
    logger.info('[email] Password-changed email sent', { to, messageId: info.messageId });
    return { sent: true };
  } catch (err) {
    logger.error('[email] Password-changed email sendMail failed', {
      to,
      err: err?.message || String(err),
      code: err?.code,
    });
    throw err;
  }
}

/**
 * Affiliate withdrawal request notification.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.name]
 * @param {'created'|'approved'|'rejected'} opts.status
 * @param {number|string} opts.requestId
 * @param {number} opts.amount
 * @param {string} [opts.currency]
 * @param {string} [opts.remarks]
 */
async function sendWithdrawalEmail(opts) {
  const { to, status, requestId } = opts;
  const subjects = {
    created: `Withdrawal request received — #${requestId}`,
    approved: `Withdrawal request approved — #${requestId}`,
    rejected: `Withdrawal request declined — #${requestId}`,
  };
  const subject = subjects[status] || `Withdrawal update — #${requestId}`;

  const templateOpts = { ...opts, siteUrl: config.publicSiteUrl };
  const text = buildWithdrawalEmailPlainText(templateOpts);
  const html = buildWithdrawalEmailHtml(templateOpts);

  if (!isSmtpConfigured()) {
    logger.warn('[email] SMTP not configured — withdrawal email not sent', { to, status });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const transport = await getTransporter();
  if (!transport) {
    logger.warn('[email] No transporter — withdrawal email not sent', { to, status });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  try {
    const info = await transport.sendMail({ from: config.smtp.from, to, subject, text, html });
    logger.info('[email] Withdrawal email sent', { to, status, requestId, messageId: info.messageId });
    return { sent: true };
  } catch (err) {
    logger.error('[email] Withdrawal email sendMail failed', {
      to,
      status,
      requestId,
      err: err?.message || String(err),
      code: err?.code,
    });
    throw err;
  }
}

module.exports = {
  sendOtpEmail,
  sendPasswordResetEmail,
  sendPaymentEmail,
  sendWelcomeEmail,
  sendPasswordChangedEmail,
  sendWithdrawalEmail,
  isSmtpConfigured,
};
