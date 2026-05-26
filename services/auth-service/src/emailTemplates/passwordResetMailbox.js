function escapeHtml(s) {
  return String(s)
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
 * @param {string} opts.resetUrl
 * @param {string} opts.siteUrl
 * @param {number} opts.ttlMinutes
 */
function buildPasswordResetMailboxHtml({ resetUrl, siteUrl, ttlMinutes }) {
  const safeResetUrl = escapeHtml(resetUrl);
  const safeSiteUrl = escapeHtml(siteUrl);
  const safeTtl = escapeHtml(String(ttlMinutes));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reset your password</title>
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
            <td style="padding:40px 40px 24px;">
              <h2 style="margin:0 0 16px;color:#1e3a5f;font-size:22px;">Reset your password</h2>
              <p style="margin:0 0 18px;color:#374151;font-size:15px;line-height:1.6;">
                We received a request to reset your Study Cafe password. Click the button below to set a new password.
              </p>

              <div style="text-align:center;margin:22px 0 26px;">
                <a href="${safeResetUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  Reset password
                </a>
              </div>

              <p style="margin:0 0 6px;color:#6b7280;font-size:13px;line-height:1.6;">
                This link expires in ${safeTtl} minutes. If you didn’t request a password reset, you can ignore this email.
              </p>

              <p style="margin:14px 0 0;color:#9ca3af;font-size:12px;line-height:1.6;">
                If the button doesn’t work, copy and paste this link into your browser:<br />
                <a href="${safeResetUrl}" style="color:#6b7280;text-decoration:underline;">${safeResetUrl}</a>
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated security message from Study Cafe — please do not reply.<br />
                Need help? Visit <a href="${safeSiteUrl}" style="color:#6b7280;text-decoration:underline;">${siteHostnameForFooter(siteUrl)}</a>
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

function buildPasswordResetPlainText({ resetUrl, siteUrl, ttlMinutes }) {
  return `Reset your password — Study Cafe

We received a request to reset your Study Cafe password.

Open this link to set a new password (expires in ${ttlMinutes} minutes):
${resetUrl}

If you didn't request this, you can ignore this email.

${siteUrl}
`;
}

module.exports = { buildPasswordResetMailboxHtml, buildPasswordResetPlainText };

