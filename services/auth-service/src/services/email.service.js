const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../../../../shared');
const { buildOtpMailboxHtml, buildOtpPlainText } = require('../emailTemplates/otpMailbox');
const {
  buildPasswordResetMailboxHtml,
  buildPasswordResetPlainText,
} = require('../emailTemplates/passwordResetMailbox');

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

module.exports = { sendOtpEmail, sendPasswordResetEmail, isSmtpConfigured };
