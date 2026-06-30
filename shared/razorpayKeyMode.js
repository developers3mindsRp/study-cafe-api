'use strict';

/**
 * Razorpay key_id prefixes determine checkout mode (test vs live).
 * @see https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/
 */
function detectRazorpayKeyMode(keyId) {
  const id = String(keyId || '').trim();
  if (!id) return 'missing';
  if (id.startsWith('rzp_live_')) return 'live';
  if (id.startsWith('rzp_test_')) return 'test';
  return 'unknown';
}

function razorpayKeyModeLabel(mode) {
  switch (mode) {
    case 'live':
      return 'Live';
    case 'test':
      return 'Test';
    case 'missing':
      return 'Missing';
    default:
      return 'Unknown';
  }
}

module.exports = {
  detectRazorpayKeyMode,
  razorpayKeyModeLabel,
};
