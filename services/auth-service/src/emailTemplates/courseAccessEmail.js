const LOGO_URL = 'https://admin.studycafe.in/images/logo/logo.svg';

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

/**
 * Sent instead of the payment-confirmation email when course access is granted
 * via an admin-created (internal) order, where payment details are not applicable.
 * No CTA buttons — just a plain confirmation of access.
 * @param {object} opts
 * @param {string} opts.itemName — course title
 * @param {string} [opts.buyerName]
 * @param {string} opts.siteUrl
 */
function buildCourseAccessEmailHtml(opts) {
  const safeUrl = escapeHtml(opts.siteUrl);
  const safeName = escapeHtml(opts.buyerName || 'there');
  const safeItemName = escapeHtml(opts.itemName || 'Course');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Access Granted</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1e3a5f;padding:32px 40px;text-align:center;">
              <div style="display:inline-block;background-color:#ffffff;padding:8px 18px;border-radius:8px;">
                <img src="${LOGO_URL}" alt="Study Cafe" height="32" style="display:block;height:32px;width:auto;" />
              </div>
              <p style="margin:10px 0 0;color:#93c5fd;font-size:14px;">Your Learning Companion</p>
            </td>
          </tr>

          <!-- Status badge -->
          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <div style="display:inline-block;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:50px;padding:10px 24px;">
                <span style="color:#16a34a;font-size:18px;font-weight:700;">✓ Access Granted</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 40px 32px;">
              <p style="margin:0;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br /><br />
                You can now access the course <strong>${safeItemName}</strong>.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated message from Study Cafe - please do not reply to this email.<br />
                Need help? Visit <a href="${safeUrl}" style="color:#6b7280;text-decoration:underline;">${siteHostnameForFooter(opts.siteUrl)}</a>
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

function buildCourseAccessEmailPlainText(opts) {
  const name = opts.buyerName || 'there';
  const itemName = opts.itemName || 'Course';

  return `Access Granted - Study Cafe\n\nHi ${name},\n\nYou can now access the course "${itemName}".\n`;
}

module.exports = { buildCourseAccessEmailHtml, buildCourseAccessEmailPlainText };
