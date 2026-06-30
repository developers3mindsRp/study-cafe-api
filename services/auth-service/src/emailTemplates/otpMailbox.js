/**
 * Transactional OTP HTML — same visual language as platform newsletter welcome
 * (see platform-service newsletter.service.js buildWelcomeEmail).
 */

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
 * @param {string} opts.otp
 * @param {'login'|'signup'} opts.purpose
 * @param {string} opts.siteUrl — e.g. https://studycafe.in
 * @param {number} opts.ttlMinutes
 */
function buildOtpMailboxHtml({ otp, purpose, siteUrl, ttlMinutes }) {
  const safeOtp = escapeHtml(otp);
  const safeUrl = escapeHtml(siteUrl);

  const isLogin = purpose === 'login';
  const title = isLogin ? 'Your sign-in code' : 'Verify your email';
  const headerLine = isLogin ? 'Your Learning Companion' : 'Your Learning Companion';
  const lead = isLogin
    ? 'Use the one-time code below to sign in to your Study Cafe account. It expires soon for your security.'
    : 'Thanks for joining Study Cafe. Enter this code on the verification page to activate your account and unlock your dashboard.';

  const ignoreLine = isLogin
    ? "If you didn't request this code, you can safely ignore this email - your password is still protected."
    : "If you didn't create an account with Study Cafe, you can ignore this email.";

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

          <!-- Header (matches newsletter) -->
          <tr>
            <td style="background-color:#1e3a5f;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:0.5px;">Study Cafe</h1>
              <p style="margin:6px 0 0;color:#93c5fd;font-size:14px;">${escapeHtml(headerLine)}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px;">
              <h2 style="margin:0 0 16px;color:#1e3a5f;font-size:22px;">${escapeHtml(title)}</h2>
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Hi there,<br /><br />
                ${lead}
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 28px;">
                <tr>
                  <td align="center" style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:24px 16px;">
                    <p style="margin:0 0 8px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Your code</p>
                    <p style="margin:0;color:#1e3a5f;font-size:32px;font-weight:700;letter-spacing:0.45em;font-family:Consolas,'Courier New',monospace;">${safeOtp}</p>
                    <p style="margin:12px 0 0;color:#9ca3af;font-size:13px;">Expires in ${escapeHtml(String(ttlMinutes))} minutes</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
                ${ignoreLine}
              </p>
              <div style="text-align:center;">
                <a href="${safeUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  Visit Study Cafe
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer (transactional - no unsubscribe) -->
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

function buildOtpPlainText({ otp, purpose, siteUrl, ttlMinutes }) {
  const isLogin = purpose === 'login';
  const title = isLogin ? 'Your sign-in code' : 'Verify your email';
  const line = isLogin
    ? `Your one-time sign-in code is ${otp}. It expires in ${ttlMinutes} minutes. If you didn't request this, you can ignore this email.`
    : `Your email verification code is ${otp}. It expires in ${ttlMinutes} minutes. If you didn't create an account, ignore this message.`;
  return `${title} - Study Cafe\n\n${line}\n\n${siteUrl}\n`;
}

module.exports = { buildOtpMailboxHtml, buildOtpPlainText };
