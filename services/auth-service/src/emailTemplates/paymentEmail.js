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
  const symbol = currency === 'INR' ? '₹' : currency + ' ';
  return symbol + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function siteHostnameForFooter(url) {
  try {
    return escapeHtml(new URL(url).hostname.replace(/^www\./, ''));
  } catch {
    return 'our website';
  }
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {object} opts
 * @param {'success'|'failed'} opts.status
 * @param {string} opts.orderId
 * @param {'course'|'membership'|'payment_link'} opts.type
 * @param {string} opts.itemName
 * @param {number} opts.amount
 * @param {string} [opts.currency]
 * @param {string} [opts.buyerName]
 * @param {string} [opts.couponCode]
 * @param {number} [opts.couponDiscount]
 * @param {number} [opts.originalAmount]
 * @param {string} [opts.paymentId]
 * @param {string} [opts.failReason]
 * @param {string} opts.siteUrl
 */
function buildPaymentEmailHtml(opts) {
  const isSuccess = opts.status === 'success';
  const safeUrl = escapeHtml(opts.siteUrl);
  const safeName = escapeHtml(opts.buyerName || 'there');
  const safeOrderId = escapeHtml(opts.orderId);
  const safeItemName = escapeHtml(opts.itemName || capitalize(opts.type));
  const typeLabel = capitalize(opts.type === 'payment_link' ? 'Purchase' : opts.type || 'Purchase');

  const title = isSuccess ? 'Payment Successful' : 'Payment Failed';
  const headerBg = isSuccess ? '#1e3a5f' : '#991b1b';
  const statusColor = isSuccess ? '#16a34a' : '#dc2626';
  const statusIcon = isSuccess ? '✓' : '✗';
  const statusText = isSuccess ? 'Payment Successful' : 'Payment Failed';

  const greeting = isSuccess
    ? `Thank you for your purchase! Your ${typeLabel.toLowerCase()} has been confirmed.`
    : `We're sorry, but your payment could not be processed. Please try again or contact support.`;

  let billRows = '';

  if (opts.originalAmount != null && opts.originalAmount !== opts.amount) {
    billRows += `
      <tr>
        <td style="padding:8px 0;color:#374151;font-size:14px;">Original Price</td>
        <td style="padding:8px 0;color:#374151;font-size:14px;text-align:right;">${formatCurrency(opts.originalAmount, opts.currency)}</td>
      </tr>`;
  }

  if (opts.couponCode && opts.couponDiscount > 0) {
    billRows += `
      <tr>
        <td style="padding:8px 0;color:#16a34a;font-size:14px;">Coupon (${escapeHtml(opts.couponCode)})</td>
        <td style="padding:8px 0;color:#16a34a;font-size:14px;text-align:right;">-${formatCurrency(opts.couponDiscount, opts.currency)}</td>
      </tr>`;
  }

  billRows += `
      <tr style="border-top:2px solid #1e3a5f;">
        <td style="padding:12px 0 8px;color:#1e3a5f;font-size:16px;font-weight:700;">Amount ${isSuccess ? 'Paid' : 'Due'}</td>
        <td style="padding:12px 0 8px;color:#1e3a5f;font-size:16px;font-weight:700;text-align:right;">${formatCurrency(opts.amount, opts.currency)}</td>
      </tr>`;

  let paymentIdRow = '';
  if (isSuccess && opts.paymentId) {
    paymentIdRow = `
      <tr>
        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Payment ID</td>
        <td style="padding:6px 0;color:#6b7280;font-size:13px;text-align:right;word-break:break-all;">${escapeHtml(opts.paymentId)}</td>
      </tr>`;
  }

  let failReasonBlock = '';
  if (!isSuccess && opts.failReason) {
    failReasonBlock = `
      <div style="background-color:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin:16px 0 0;">
        <p style="margin:0;color:#991b1b;font-size:13px;"><strong>Reason:</strong> ${escapeHtml(opts.failReason)}</p>
      </div>`;
  }

  const ctaLabel = isSuccess ? 'Go to Dashboard' : 'Try Again';
  const ctaUrl = isSuccess ? `${safeUrl}/dashboard/my-purchases` : safeUrl;

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

          <!-- Header -->
          <tr>
            <td style="background-color:${headerBg};padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:0.5px;">Study Cafe</h1>
              <p style="margin:6px 0 0;color:#93c5fd;font-size:14px;">Your Learning Companion</p>
            </td>
          </tr>

          <!-- Status badge -->
          <tr>
            <td style="padding:32px 40px 0;text-align:center;">
              <div style="display:inline-block;background-color:${isSuccess ? '#f0fdf4' : '#fef2f2'};border:1px solid ${isSuccess ? '#bbf7d0' : '#fecaca'};border-radius:50px;padding:10px 24px;">
                <span style="color:${statusColor};font-size:18px;font-weight:700;">${statusIcon} ${statusText}</span>
              </div>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:24px 40px 16px;">
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${safeName},<br /><br />
                ${greeting}
              </p>

              <!-- Order details card -->
              <div style="background-color:#f9fafc;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <h3 style="margin:0 0 16px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Order Details</h3>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;font-size:13px;">Order ID</td>
                    <td style="padding:6px 0;color:#374151;font-size:13px;text-align:right;font-weight:600;">${safeOrderId}</td>
                  </tr>
                  <tr>
                    <td style="padding:6px 0;color:#6b7280;font-size:13px;">${typeLabel}</td>
                    <td style="padding:6px 0;color:#374151;font-size:13px;text-align:right;font-weight:600;">${safeItemName}</td>
                  </tr>
                  ${paymentIdRow}
                </table>
              </div>

              <!-- Bill summary -->
              <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:20px 24px;margin:0 0 24px;">
                <h3 style="margin:0 0 12px;color:#1e3a5f;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;">Payment Summary</h3>
                <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                  ${billRows}
                </table>
              </div>

              ${failReasonBlock}

              <div style="text-align:center;margin-top:24px;">
                <a href="${ctaUrl}" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  ${ctaLabel}
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                This is an automated receipt from Study Cafe - please do not reply to this email.<br />
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

function buildPaymentEmailPlainText(opts) {
  const isSuccess = opts.status === 'success';
  const title = isSuccess ? 'Payment Successful' : 'Payment Failed';
  const name = opts.buyerName || 'there';
  const itemName = opts.itemName || capitalize(opts.type || 'Purchase');
  const amount = formatCurrency(opts.amount, opts.currency);

  let text = `${title} - Study Cafe\n\nHi ${name},\n\n`;
  if (isSuccess) {
    text += `Your payment of ${amount} for "${itemName}" has been confirmed.\n`;
    text += `Order ID: ${opts.orderId}\n`;
    if (opts.paymentId) text += `Payment ID: ${opts.paymentId}\n`;
  } else {
    text += `Your payment of ${amount} for "${itemName}" could not be processed.\n`;
    text += `Order ID: ${opts.orderId}\n`;
    if (opts.failReason) text += `Reason: ${opts.failReason}\n`;
    text += `\nPlease try again or contact support.\n`;
  }
  text += `\n${opts.siteUrl}\n`;
  return text;
}

module.exports = { buildPaymentEmailHtml, buildPaymentEmailPlainText };
