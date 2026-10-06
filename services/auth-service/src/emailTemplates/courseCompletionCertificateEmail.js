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
 * Serves two audiences from one template:
 *   - a learner who finished a course (no claimUrl — they go to their account)
 *   - someone who claimed a certificate through a public certificate link (claimUrl present — they
 *     re-open that link and enter the same email to get the same certificate back — this keeps
 *     working after the link expires or fills up, see retrieve() in course-service)
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.courseTitle
 * @param {string} opts.completionDate (YYYY-MM-DD)
 * @param {string} [opts.certificateNumber] e.g. "SC-5012"
 * @param {string} [opts.claimUrl] public claim page, set only for link-issued certificates
 * @param {string} [opts.siteUrl]
 */
function buildCourseCompletionCertificateEmailHtml(opts) {
  const safeName = escapeHtml(opts.name || 'there');
  const safeCourse = escapeHtml(opts.courseTitle || 'Course');
  const safeCompletionDate = escapeHtml(opts.completionDate || '');
  const safeUrl = escapeHtml(opts.siteUrl || '');
  const safeSerial = escapeHtml(opts.certificateNumber || '');
  const safeClaimUrl = escapeHtml(opts.claimUrl || '');
  const ctaHref = safeClaimUrl || `${safeUrl}/account`;
  const ctaLabel = safeClaimUrl ? 'Download my certificate' : 'Go to my account';
  const howToGetIt = safeClaimUrl
    ? 'Your certificate is ready. To download it again at any time, open the link below and enter this email address.'
    : 'Your certificate is ready. Open the course page, click <strong>Certificate</strong>, and print / save as PDF.';
  const serialLine = safeSerial
    ? `<p style="margin:12px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                  Certificate Serial No.: <strong>${safeSerial}</strong>
                </p>`
    : '';

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
              <div style="display:inline-block;background-color:#ffffff;padding:8px 18px;border-radius:8px;">
                <img src="${LOGO_URL}" alt="Study Cafe" height="32" style="display:block;height:32px;width:auto;" />
              </div>
              <p style="margin:10px 0 0;color:#93c5fd;font-size:14px;">Your Learning Companion</p>
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
                  ${howToGetIt}
                </p>
                <p style="margin:12px 0 0;color:#6b7280;font-size:13px;line-height:1.6;">
                  Completed on: <strong>${safeCompletionDate}</strong>
                </p>
                ${serialLine}
              </div>

              <div style="text-align:center;margin-top:8px;">
                <a href="${ctaHref}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  ${ctaLabel}
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated learning confirmation from Study Cafe - please do not reply to this email.<br />
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
  const claimUrl = opts.claimUrl || '';
  const serial = opts.certificateNumber || '';

  const howToGetIt = claimUrl
    ? 'Your certificate is ready. To download it again at any time, open the link below and enter this email address.'
    : 'Your certificate is ready. Open the course page and click Certificate to print / save as PDF.';
  const serialLine = serial ? `Certificate Serial No.: ${serial}\n` : '';
  const cta = claimUrl
    ? `Download my certificate: ${claimUrl}\n`
    : `Go to my account: ${siteUrl}/account\n`;

  return `Course completed - Study Cafe\n\nHi ${name},\n\nCongratulations! You completed "${courseTitle}".\n${howToGetIt}\n\nCompleted on: ${completionDate}\n${serialLine}${cta}`;
}

module.exports = {
  buildCourseCompletionCertificateEmailHtml,
  buildCourseCompletionCertificateEmailPlainText,
};

