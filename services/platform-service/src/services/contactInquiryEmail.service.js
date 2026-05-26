const config = require('../config');
const { logger } = require('../../../../shared');
const { sendMail } = require('./mailer.service');
const {
  buildAdminNewEnquiryHtml,
  buildUserEnquiryConfirmationHtml,
  buildAdminNewEnquiryPlainText,
  buildUserEnquiryConfirmationPlainText,
} = require('../emailTemplates/contactInquiryEmail');

function isSmtpConfigured() {
  return Boolean(config.smtp.host && config.smtp.user);
}

function getSiteUrl() {
  const url = (config.publicSiteUrl || config.publicBaseUrl || 'https://studycafe.in').replace(/\/+$/, '');
  return url;
}

/**
 * Notify admin and confirm receipt to the user. Non-blocking — logs failures, never throws.
 * @param {object} inquiry — plain contact_inquiries row
 */
async function sendContactInquiryEmails(inquiry) {
  if (!isSmtpConfigured()) {
    logger.warn('[contact-email] SMTP not configured — enquiry emails skipped', {
      inquiryId: inquiry?.id,
    });
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const siteUrl = getSiteUrl();
  const adminTo = config.contactAdminEmail;
  const userTo = inquiry.email;

  if (!adminTo) {
    logger.warn('[contact-email] CONTACT_ADMIN_EMAIL not set — admin notification skipped');
  }

  const results = { admin: null, user: null };

  if (adminTo) {
    results.admin = await sendMail({
      to: adminTo,
      subject: `New contact enquiry from ${inquiry.first_name || ''} ${inquiry.last_name || ''}`.trim(),
      html: buildAdminNewEnquiryHtml(inquiry, siteUrl),
      text: buildAdminNewEnquiryPlainText(inquiry, siteUrl),
    });
  }

  if (userTo) {
    results.user = await sendMail({
      to: userTo,
      subject: 'We received your enquiry — Study Cafe',
      html: buildUserEnquiryConfirmationHtml(inquiry, siteUrl),
      text: buildUserEnquiryConfirmationPlainText(inquiry, siteUrl),
    });
  }

  logger.info('[contact-email] enquiry emails dispatched', {
    inquiryId: inquiry.id,
    admin: results.admin,
    user: results.user,
  });

  return { sent: true, results };
}

module.exports = { sendContactInquiryEmails };
