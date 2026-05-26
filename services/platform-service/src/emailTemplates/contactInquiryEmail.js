function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function siteHostnameForFooter(url) {
  try {
    return escapeHtml(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return 'our website';
  }
}

function formatPhone(countryCode, mobile) {
  const cc = countryCode ? String(countryCode).trim() : '';
  const mob = mobile ? String(mobile).trim() : '';
  if (!mob) return '—';
  return cc && cc !== 'IN' ? `${escapeHtml(cc)} ${escapeHtml(mob)}` : escapeHtml(mob);
}

function inquiryDetailsRows(inquiry) {
  const fullName = `${inquiry.first_name || ''} ${inquiry.last_name || ''}`.trim();
  const subject = inquiry.subject ? escapeHtml(inquiry.subject) : '—';
  const message = escapeHtml(inquiry.message || '').replace(/\n/g, '<br />');

  return `
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;width:120px;">Name</td>
      <td style="padding:8px 0;color:#374151;font-size:14px;font-weight:600;">${escapeHtml(fullName || '—')}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;">Email</td>
      <td style="padding:8px 0;color:#374151;font-size:14px;">${escapeHtml(inquiry.email)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;">Phone</td>
      <td style="padding:8px 0;color:#374151;font-size:14px;">${formatPhone(inquiry.country_code, inquiry.mobile_number)}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;">Subject</td>
      <td style="padding:8px 0;color:#374151;font-size:14px;">${subject}</td>
    </tr>
    <tr>
      <td style="padding:8px 0;color:#6b7280;font-size:13px;vertical-align:top;">Message</td>
      <td style="padding:8px 0;color:#374151;font-size:14px;line-height:1.6;">${message}</td>
    </tr>`;
}

function emailShell({ title, headerBg, badgeHtml, bodyHtml, siteUrl }) {
  const safeUrl = escapeHtml(siteUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:${headerBg};padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:0.5px;">Study Cafe</h1>
              <p style="margin:6px 0 0;color:#93c5fd;font-size:14px;">Your Learning Companion</p>
            </td>
          </tr>
          ${badgeHtml}
          <tr>
            <td style="padding:24px 40px 16px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated message from Study Cafe — please do not reply to this email.<br />
                Need help? Visit <a href="${safeUrl}" style="color:#6b7280;text-decoration:underline;">${siteHostnameForFooter(siteUrl)}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Admin notification: new contact enquiry */
function buildAdminNewEnquiryHtml(inquiry, siteUrl) {
  const inquiryId = inquiry.id != null ? `#${inquiry.id}` : '';
  const badge = `
    <tr>
      <td style="padding:32px 40px 0;text-align:center;">
        <div style="display:inline-block;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:50px;padding:10px 24px;">
          <span style="color:#1d4ed8;font-size:16px;font-weight:700;">New contact enquiry ${escapeHtml(inquiryId)}</span>
        </div>
      </td>
    </tr>`;

  const body = `
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      You have received a new enquiry from the Contact Us form on Study Cafe.
    </p>
    <div style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;">
      <h3 style="margin:0 0 16px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Enquiry details</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${inquiryDetailsRows(inquiry)}
      </table>
    </div>`;

  return emailShell({
    title: 'New contact enquiry',
    headerBg: '#1e3a5f',
    badgeHtml: badge,
    bodyHtml: body,
    siteUrl,
  });
}

/** User confirmation after submitting contact form */
function buildUserEnquiryConfirmationHtml(inquiry, siteUrl) {
  const firstName = escapeHtml(inquiry.first_name || 'there');
  const badge = `
    <tr>
      <td style="padding:32px 40px 0;text-align:center;">
        <div style="display:inline-block;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:50px;padding:10px 24px;">
          <span style="color:#16a34a;font-size:16px;font-weight:700;">We received your message</span>
        </div>
      </td>
    </tr>`;

  const body = `
    <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
      Hi ${firstName},<br /><br />
      Thank you for contacting Study Cafe. We have received your enquiry and our team will get back to you as soon as possible.
    </p>
    <div style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
      <h3 style="margin:0 0 16px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Your submission</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        ${inquiryDetailsRows(inquiry)}
      </table>
    </div>
    <p style="margin:0;color:#6b7280;font-size:14px;line-height:1.6;">
      Typical response time is 1–2 business days. For urgent matters, please mention it in your message subject.
    </p>`;

  return emailShell({
    title: 'Enquiry received',
    headerBg: '#1e3a5f',
    badgeHtml: badge,
    bodyHtml: body,
    siteUrl,
  });
}

function buildAdminNewEnquiryPlainText(inquiry, siteUrl) {
  const name = `${inquiry.first_name || ''} ${inquiry.last_name || ''}`.trim();
  return `New contact enquiry — Study Cafe\n\nName: ${name}\nEmail: ${inquiry.email}\nPhone: ${inquiry.mobile_number || '—'}\nSubject: ${inquiry.subject || '—'}\n\nMessage:\n${inquiry.message}\n\n${siteUrl}\n`;
}

function buildUserEnquiryConfirmationPlainText(inquiry, siteUrl) {
  const name = inquiry.first_name || 'there';
  return `We received your enquiry — Study Cafe\n\nHi ${name},\n\nThank you for contacting Study Cafe. We have received your message and will respond as soon as possible.\n\nSubject: ${inquiry.subject || '—'}\n\n${siteUrl}\n`;
}

module.exports = {
  buildAdminNewEnquiryHtml,
  buildUserEnquiryConfirmationHtml,
  buildAdminNewEnquiryPlainText,
  buildUserEnquiryConfirmationPlainText,
};
