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
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.email
 * @param {string} opts.siteUrl
 */
function buildPasswordChangedEmailHtml({ name, email, siteUrl }) {
  const safeName = escapeHtml(name || 'there');
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(siteUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password changed</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <tr>
            <td style="background-color:#1e3a5f;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:0.5px;">Study Cafe</h1>
              <p style="margin:6px 0 0;color:#93c5fd;font-size:14px;">Your Learning Companion</p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 16px;">
              <h2 style="margin:0 0 16px;color:#1e3a5f;font-size:22px;">Your password was changed</h2>
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br /><br />
                This is a confirmation that the password for your Study Cafe account (<strong>${safeEmail}</strong>) was changed successfully.
              </p>

              <div style="background-color:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
                <p style="margin:0;color:#92400e;font-size:14px;line-height:1.6;">
                  <strong>Didn't make this change?</strong><br />
                  If you did not update your password, please reset it immediately or contact our support team.
                </p>
              </div>

              <div style="text-align:center;">
                <a href="${safeUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  Visit Study Cafe
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated security message from Study Cafe - please do not reply to this email.<br />
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

function buildPasswordChangedEmailPlainText({ name, email, siteUrl }) {
  const safeName = name || 'there';
  return `Your password was changed - Study Cafe\n\nHi ${safeName},\n\nThe password for your account (${email}) was changed successfully.\n\nIf you did not make this change, please reset your password or contact support immediately.\n\n${siteUrl}\n`;
}

module.exports = { buildPasswordChangedEmailHtml, buildPasswordChangedEmailPlainText };
