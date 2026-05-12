/**
 * Pro-rated credit for the unused portion of a term-based membership plan.
 *
 * Caps calendar remaining time at one billing period (`duration_days`) so rows
 * with far-future expiry (e.g. lifetime-style +100y) cannot produce more credit
 * than the full plan price. Credit is also hard-capped at `planPrice`.
 *
 * @param {object} opts
 * @param {number|string} opts.planPrice
 * @param {number|null|undefined} opts.durationDays
 * @param {Date|string} opts.expiresAt
 * @param {Date} [opts.now]
 * @param {boolean} [opts.isLifetime]
 * @returns {{ upgradeDeduction: number, effectiveRemainingDays: number, remainingCalendarDays: number }}
 */
function computeMembershipUpgradeCredit({
  planPrice,
  durationDays,
  expiresAt,
  now = new Date(),
  isLifetime = false,
}) {
  if (isLifetime || durationDays == null || Number(durationDays) <= 0) {
    return { upgradeDeduction: 0, effectiveRemainingDays: 0, remainingCalendarDays: 0 };
  }

  const exp = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  const remainingMs = Math.max(0, exp.getTime() - now.getTime());
  const remainingCalendarDays = remainingMs / (1000 * 60 * 60 * 24);

  if (remainingCalendarDays <= 0) {
    return { upgradeDeduction: 0, effectiveRemainingDays: 0, remainingCalendarDays: 0 };
  }

  const price = Number(planPrice);
  const dur = Number(durationDays);
  const effectiveRemainingDays = Math.min(remainingCalendarDays, dur);

  let upgradeDeduction = (price / dur) * effectiveRemainingDays;
  upgradeDeduction = Math.min(upgradeDeduction, price);
  upgradeDeduction = Number(upgradeDeduction.toFixed(2));

  return {
    upgradeDeduction,
    effectiveRemainingDays: Math.round(effectiveRemainingDays),
    remainingCalendarDays: Math.round(remainingCalendarDays),
  };
}

module.exports = { computeMembershipUpgradeCredit };
