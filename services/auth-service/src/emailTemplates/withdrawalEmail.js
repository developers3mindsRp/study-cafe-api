const LOGO_URL = 'https://admin.studycafe.in/images/logo/logo.svg';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(amount, currency = 'INR') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0.00';
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return symbol + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function siteHostnameForFooter(url) {
  try {
    return escapeHtml(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return 'our website';
  }
}

function displayStatus(status) {
  if (status === 'created') return 'Pending review';
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Declined';
  return String(status);
}

function statusMeta(status) {
  if (status === 'created') {
    return {
      title: 'Withdrawal request received',
      headerBg: '#1e3a5f',
      badgeBg: '#eff6ff',
      badgeBorder: '#bfdbfe',
      badgeColor: '#1d4ed8',
      badgeText: 'Request submitted',
      lead: 'We have received your affiliate withdrawal request. Our team will review it and update you once it is processed.',
    };
  }
  if (status === 'approved') {
    return {
      title: 'Withdrawal request approved',
      headerBg: '#1e3a5f',
      badgeBg: '#f0fdf4',
      badgeBorder: '#bbf7d0',
      badgeColor: '#16a34a',
      badgeText: 'Approved',
      lead: 'Good news! Your affiliate withdrawal request has been approved. The payout will be processed as per our affiliate payment schedule.',
    };
  }
  return {
    title: 'Withdrawal request declined',
    headerBg: '#991b1b',
    badgeBg: '#fef2f2',
    badgeBorder: '#fecaca',
    badgeColor: '#dc2626',
    badgeText: 'Declined',
    lead: 'Your affiliate withdrawal request could not be approved at this time. Please see the remarks below for more information.',
  };
}

/**
 * @param {object} opts
 * @param {'created'|'approved'|'rejected'} opts.status
 * @param {string} opts.name
 * @param {number|string} opts.requestId
 * @param {number} opts.amount
 * @param {string} [opts.currency]
 * @param {string} [opts.remarks]
 * @param {string} opts.siteUrl
 */
function buildWithdrawalEmailHtml(opts) {
  const meta = statusMeta(opts.status);
  
  const safeName = escapeHtml(opts.name || 'there');
  const safeId = escapeHtml(String(opts.requestId));
  const amount = formatCurrency(opts.amount, opts.currency);

  const url =
  opts.siteUrl && opts.siteUrl.includes("localhost")
    ? "https://studycafe.in"
    : opts.siteUrl;
  const safeUrl = escapeHtml(url);

  let remarksBlock = '';
  if (opts.status === 'rejected' && opts.remarks) {
    remarksBlock = `
      <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 20px;margin:0 0 24px;">
        <p style="margin:0 0 6px;color:#991b1b;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Remarks</p>
        <p style="margin:0;color:#7f1d1d;font-size:14px;line-height:1.6;">${escapeHtml(opts.remarks).replace(/\n/g, '<br />')}</p>
      </div>`;
  }

  const ctaLabel = 'Dashboard';
  const ctaUrl = `${safeUrl}/dashboard`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <tr>
            <td style="background-color:${meta.headerBg};padding:32px 40px;text-align:center;">
              <div style="display:inline-block;background-color:#ffffff;padding:8px 18px;border-radius:8px;">
                <img src="${LOGO_URL}" alt="Study Cafe" height="32" style="display:block;height:32px;width:auto;" />
              </div>
              <p style="margin:10px 0 0;color:#93c5fd;font-size:14px;">Affiliate program</p>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <div style="display:inline-block;background-color:${meta.badgeBg};border:1px solid ${meta.badgeBorder};border-radius:50px;padding:10px 24px;">
                <span style="color:${meta.badgeColor};font-size:16px;font-weight:700;">${escapeHtml(meta.badgeText)}</span>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 16px;">
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br /><br />
                ${meta.lead}
              </p>

              <div style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <h3 style="margin:0 0 16px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Request details</h3>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:13px;">Request ID</td>
                    <td style="padding:8px 0;color:#374151;font-size:14px;text-align:right;font-weight:600;">#${safeId}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:13px;">Amount</td>
                    <td style="padding:8px 0;color:#1e3a5f;font-size:16px;text-align:right;font-weight:700;">${amount}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#6b7280;font-size:13px;">Status</td>
                    <td style="padding:8px 0;color:#374151;font-size:14px;text-align:right;font-weight:600;">${escapeHtml(displayStatus(opts.status))}</td>
                  </tr>
                </table>
              </div>

              ${remarksBlock}

              <div style="text-align:center;margin-top:8px;">
                <a href="${ctaUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  ${ctaLabel}
                </a>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated message from Study Cafe - please do not reply to this email.<br />
                Questions? Visit <a href="${safeUrl}" style="color:#6b7280;text-decoration:underline;">${siteHostnameForFooter(opts.siteUrl)}</a>
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

function buildWithdrawalEmailPlainText(opts) {
  const name = opts.name || 'there';
  const amount = formatCurrency(opts.amount, opts.currency);
  const id = opts.requestId;
  let text = `${statusMeta(opts.status).title} - Study Cafe\n\nHi ${name},\n\n`;
  if (opts.status === 'created') {
    text += `Your withdrawal request #${id} for ${amount} has been submitted and is pending review.\n`;
  } else if (opts.status === 'approved') {
    text += `Your withdrawal request #${id} for ${amount} has been approved.\n`;
  } else {
    text += `Your withdrawal request #${id} for ${amount} was declined.\n`;
    if (opts.remarks) text += `\nRemarks: ${opts.remarks}\n`;
  }
  text += `\n${opts.siteUrl}\n`;
  return text;
}

module.exports = { buildWithdrawalEmailHtml, buildWithdrawalEmailPlainText };
