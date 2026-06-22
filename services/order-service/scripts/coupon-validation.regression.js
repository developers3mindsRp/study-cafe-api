/**
 * Pure-logic regression checks for coupon validation (no DB).
 * Run: node scripts/coupon-validation.regression.js
 */

function parseAmount(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isCouponPublished(status) {
  if (status == null || String(status).trim() === '') return false;
  const s = String(status).toLowerCase().trim();
  return s === 'publish' || s === 'published' || s === 'active';
}

function couponExpireEndInstant(expireDateRaw) {
  if (!expireDateRaw) return null;
  const d = new Date(expireDateRaw);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function getCouponDateState(coupon, now = new Date()) {
  const startDate = coupon.start_date ? new Date(coupon.start_date) : null;
  const expireEnd = couponExpireEndInstant(coupon.expire_date);
  const notYetActive =
    startDate && !Number.isNaN(startDate.getTime()) && now < startDate;
  const expired = expireEnd && now > expireEnd;
  const dateValid = !notYetActive && !expired;
  return { notYetActive, expired, dateValid };
}

function isCouponTypeValid(coupon, typeUpper) {
  const on = String(coupon.discount_on || 'all').toLowerCase();
  if (on === 'all') return true;
  return on === String(typeUpper || '').toLowerCase();
}

function resolveCouponInactiveReason(coupon, amount, typeUpper) {
  const validType = isCouponTypeValid(coupon, typeUpper);
  if (!validType) return 'Coupon not applicable for selected type';

  const { notYetActive, expired } = getCouponDateState(coupon);
  if (notYetActive) return 'Coupon not active yet';
  if (expired) return 'Coupon has expired';

  const published = isCouponPublished(coupon.status);
  if (!published) return 'Coupon is not published';

  const meetsMinOrder = amount >= parseAmount(coupon.min_order);
  if (!meetsMinOrder) {
    return `Minimum order value ₹${parseAmount(coupon.min_order)} required`;
  }

  return null;
}

function couponInactiveReasonToMessage(inactiveReason) {
  switch (inactiveReason) {
    case 'Coupon has expired':
      return 'Coupon expired';
    case 'Coupon not active yet':
      return 'This coupon is not active yet';
    case 'Coupon is not published':
      return 'This coupon is no longer valid';
    case 'Coupon not applicable for selected type':
      return 'This coupon does not apply to this purchase';
    default:
      return inactiveReason || 'Coupon cannot be applied';
  }
}

function buildCouponResult(coupon, amount, typeUpper) {
  const inactiveReason = resolveCouponInactiveReason(coupon, amount, typeUpper);
  const canApply = !inactiveReason;
  return {
    canApply,
    inactiveReason: inactiveReason ? couponInactiveReasonToMessage(inactiveReason) : null,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const base = {
  code: 'TEST10',
  type: 'percentage',
  value: 10,
  min_order: 0,
  max_discount: 0,
  discount_on: 'all',
  status: 'publish',
};

// Valid published coupon
assert(
  buildCouponResult({ ...base, expire_date: '2026-12-31' }, 1000, 'COURSE').canApply === true,
  'valid coupon should apply',
);

// CP-013: expired coupon → user-facing "Coupon expired"
const expired = buildCouponResult(
  { ...base, expire_date: '2026-06-08' },
  1000,
  'COURSE',
);
assert(expired.canApply === false, 'expired coupon should not apply');
assert(expired.inactiveReason === 'Coupon expired', `expected "Coupon expired", got "${expired.inactiveReason}"`);

// Expire date inclusive through end of day UTC
const noonUtc = new Date('2026-06-09T12:00:00.000Z');
const endOfDayState = getCouponDateState({ expire_date: '2026-06-09' }, noonUtc);
assert(endOfDayState.expired === false, 'coupon expiring today should not be expired at noon UTC');
const justAfterEnd = new Date('2026-06-10T00:00:00.001Z');
const afterExpire = getCouponDateState({ expire_date: '2026-06-09' }, justAfterEnd);
assert(afterExpire.expired === true, 'coupon should expire after end of expire_date UTC day');

// Null/empty status must NOT be treated as published (backward compat)
assert(isCouponPublished(null) === false, 'null status is not published');
assert(isCouponPublished('') === false, 'empty status is not published');
assert(isCouponPublished('publish') === true, 'publish status is published');

const draft = buildCouponResult({ ...base, status: null, expire_date: '2026-12-31' }, 1000, 'COURSE');
assert(draft.canApply === false, 'null-status coupon must not apply');

// Unpublished draft
const unpublished = buildCouponResult(
  { ...base, status: 'draft', expire_date: '2026-12-31' },
  1000,
  'COURSE',
);
assert(unpublished.inactiveReason === 'This coupon is no longer valid', 'draft → no longer valid message');

// Not yet active
const future = buildCouponResult(
  { ...base, start_date: '2026-12-01', expire_date: '2026-12-31' },
  1000,
  'COURSE',
);
assert(future.inactiveReason === 'This coupon is not active yet', 'future start → not active yet');

console.log('coupon-validation.regression.js: all checks passed');
