const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('../../../../shared');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

function renderUnsubscribeFooter(unsubscribeUrl) {
  return `
    <hr style="margin-top:32px;border:none;border-top:1px solid #e5e7eb" />
    <p style="font-size:12px;color:#6b7280;margin-top:12px">
      You are receiving this because you subscribed to our newsletter.
      <a href="${unsubscribeUrl}" style="color:#6b7280">Unsubscribe</a>
    </p>
  `;
}

function buildUnsubscribeUrl(token) {
  return `${config.publicBaseUrl}/api/platform/newsletter/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Send a single email. Returns { ok: true } or { ok: false, error }.
 * Never throws — caller can tally success/failure.
 */
async function sendMail({ to, subject, html, text }) {
  try {
    logger.info(
      `[mailer] attempt to=${to} subject="${subject}" host=${config.smtp.host || 'not-set'} port=${config.smtp.port}`,
    );
    const info = await getTransporter().sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      ...(text ? { text } : {}),
    });
    // SMTP accepted the message; inbox delivery is tracked in your provider (e.g. Mailgun logs).
    logger.info(
      `[mailer] accepted by SMTP for ${to} messageId=${info.messageId || 'n/a'} response=${(info.response || '').trim()}`,
    );
    return { ok: true };
  } catch (err) {
    logger.error(`[mailer] failed to send to ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendMail,
  buildUnsubscribeUrl,
  renderUnsubscribeFooter,
};
