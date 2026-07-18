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
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.email
 * @param {string} opts.siteUrl
 */
function buildWelcomeEmailHtml({ name, email, siteUrl }) {
  const safeName = escapeHtml(name || 'there');
  const safeEmail = escapeHtml(email);
  const url =
  siteUrl.includes("localhost")
    ? "https://studycafe.in"
    : siteUrl;
 
const safeUrl = escapeHtml(url);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Study Cafe</title>
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

          <!-- Welcome badge -->
          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <div style="display:inline-block;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:50px;padding:10px 24px;">
                <span style="color:#16a34a;font-size:18px;font-weight:700;">&#127881; Welcome Aboard!</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 40px 16px;">
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br /><br />
                Thank you for registering with <strong>Study Cafe</strong>! Your account has been created successfully.
              </p>

              <!-- Account details card -->
              <div style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Your Account</h3>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;font-size:13px;">Name</td>
                    <td style="padding:6px 0;color:#374151;font-size:13px;text-align:right;font-weight:600;">${safeName}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;font-size:13px;">Email</td>
                    <td style="padding:6px 0;color:#374151;font-size:13px;text-align:right;font-weight:600;">${safeEmail}</td>
                  </tr>
                </table>
              </div>

              <!-- What's next -->
              <div style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:16px;">What's Next?</h3>
                <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;line-height:1.8;">
                  <li>Browse our expert-led courses</li>
                  <li>Explore membership plans for unlimited access</li>
                  <li>Read insightful articles on our blog</li>
                </ul>
              </div>

              <div style="text-align:center;margin-top:24px;">
                <a href="${safeUrl}/courses" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  Explore Courses
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated message from Study Cafe - please do not reply to this email.<br />
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

function buildWelcomeEmailPlainText({ name, email, siteUrl }) {
  const safeName = name || 'there';
  return `Welcome to Study Cafe!\n\nHi ${safeName},\n\nThank you for registering with Study Cafe! Your account (${email}) has been created successfully.\n\nWhat's next?\n- Browse our expert-led courses\n- Explore membership plans for unlimited access\n- Read insightful articles on our blog\n\n${siteUrl}\n`;
}

module.exports = { buildWelcomeEmailHtml, buildWelcomeEmailPlainText };
