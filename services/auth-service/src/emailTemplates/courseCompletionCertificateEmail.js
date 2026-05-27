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
 * @param {string} opts.courseTitle
 * @param {string} opts.completionDate (YYYY-MM-DD)
 * @param {string} [opts.siteUrl]
 */
function buildCourseCompletionCertificateEmailHtml(opts) {
  const safeName = escapeHtml(opts.name || 'there');
  const safeCourse = escapeHtml(opts.courseTitle || 'Course');
  const safeCompletionDate = escapeHtml(opts.completionDate || '');
  const safeUrl = escapeHtml(opts.siteUrl || '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Certificate ready</title>
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
            <td style="padding:32px 40px 0;text-align:center;">
              <div style="display:inline-block;background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:50px;padding:10px 24px;">
                <span style="color:#16a34a;font-size:18px;font-weight:700;">✓ Course completed</span>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 16px;">
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br /><br />
                Congratulations! You completed <strong>${safeCourse}</strong>.
              </p>

              <div style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Certificate</h3>
                <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">
                  Your certificate is ready. Open the course page, click <strong>Certificate</strong>, and print / save as PDF.
                </p>
                <p style="margin:12px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                  Completed on: <strong>${safeCompletionDate}</strong>
                </p>
              </div>

              <div style="text-align:center;margin-top:8px;">
                <a href="${safeUrl}/account" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  Go to my account
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated learning confirmation from Study Cafe — please do not reply to this email.<br />
                Need help? Visit <a href="${safeUrl}" style="color:#6b7280;text-decoration:underline;">${siteHostnameForFooter(safeUrl)}</a>
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

function buildCourseCompletionCertificateEmailPlainText(opts) {
  const name = opts.name || 'there';
  const courseTitle = opts.courseTitle || 'Course';
  const completionDate = opts.completionDate || '';
  const siteUrl = opts.siteUrl || '';
  return `Course completed — Study Cafe\n\nHi ${name},\n\nCongratulations! You completed "${courseTitle}".\nYour certificate is ready. Open the course page and click Certificate to print / save as PDF.\n\nCompleted on: ${completionDate}\nGo to my account: ${siteUrl}/account\n`;
}

module.exports = {
  buildCourseCompletionCertificateEmailHtml,
  buildCourseCompletionCertificateEmailPlainText,
};

