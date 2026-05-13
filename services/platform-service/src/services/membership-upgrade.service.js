const { Op } = require('sequelize');
const { PremiumPlan, UserMembership } = require('../models');
const { AppError, computeMembershipUpgradeCredit } = require('../../../../shared');

const GST_RATE = 0.18;

/**
 * Calculate the pro-rated upgrade pricing for a user moving from their current
 * active membership to a higher-tier target plan.
 *
 * @param {number|string} userId
 * @param {number|string} targetPlanId
 * @returns {object} Pricing breakdown
 */
async function calculateMembershipUpgrade(userId, targetPlanId) {
  if (!targetPlanId) throw new AppError('targetPlanId is required', 400);

  // Load target plan
  const targetPlan = await PremiumPlan.findOne({
    where: { id: targetPlanId, is_active: true },
  });
  if (!targetPlan) throw new AppError('Target plan not found or inactive', 404);

  const targetPrice = Number(targetPlan.price);
  const targetSortOrder = Number(targetPlan.sort_order ?? 0);

  // Load user's active membership (starts_at <= now, expires_at >= now)
  const now = new Date();
  const activeMembership = await UserMembership.findOne({
    where: {
      user_id: userId,
      starts_at: { [Op.lte]: now },
      expires_at: { [Op.gte]: now },
    },
    order: [['expires_at', 'DESC']],
  });

  // No active membership — new purchase at full price
  if (!activeMembership) {
    const gstAmount = Number((targetPrice * GST_RATE).toFixed(2));
    const grandTotal = Number((targetPrice + gstAmount).toFixed(2));
    return {
      canUpgrade: true,
      currentPlan: null,
      targetPlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        price: targetPrice,
      },
      pricing: {
        targetAmount: targetPrice,
        deductAmount: 0,
        finalAmount: targetPrice,
        gstAmount,
        grandTotal,
      },
    };
  }

  // Find current plan details via slug stored in membership_type
  const currentPlan = await PremiumPlan.findOne({
    where: { slug: activeMembership.membership_type },
  });

  const activeSortOrder = currentPlan ? Number(currentPlan.sort_order ?? 0) : 0;

  // Validate upgrade direction — return as success with canUpgrade: false instead of throwing
  if (targetSortOrder === activeSortOrder && currentPlan && currentPlan.id === Number(targetPlanId)) {
    return {
      canUpgrade: false,
      message: 'You are already on this plan.',
      currentPlan: {
        id: currentPlan.id,
        name: currentPlan.name,
        slug: activeMembership.membership_type,
        price: Number(currentPlan.price),
      },
      targetPlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        price: targetPrice,
      },
    };
  }
  if (targetSortOrder <= activeSortOrder) {
    const activeName = currentPlan ? currentPlan.name : activeMembership.membership_type;
    return {
      canUpgrade: false,
      message: `You can only upgrade to a higher tier. You currently have "${activeName}".`,
      currentPlan: {
        id: currentPlan?.id ?? null,
        name: activeName,
        slug: activeMembership.membership_type,
        price: currentPlan ? Number(currentPlan.price) : 0,
      },
      targetPlan: {
        id: targetPlan.id,
        name: targetPlan.name,
        price: targetPrice,
      },
    };
  }

  // Pro-rated deduction — skip for lifetime plans or plans without duration_days
  let deductAmount = 0;
  let remainingDaysForDisplay = 0;
  let remainingCalendarDays = 0;

  if (currentPlan && !currentPlan.is_lifetime && currentPlan.duration_days && currentPlan.duration_days > 0) {
    const { upgradeDeduction, effectiveRemainingDays, remainingCalendarDays: calDays } =
      computeMembershipUpgradeCredit({
        planPrice: currentPlan.price,
        durationDays: currentPlan.duration_days,
        expiresAt: activeMembership.expires_at,
        now,
        isLifetime: !!currentPlan.is_lifetime,
      });
    deductAmount = upgradeDeduction;
    remainingDaysForDisplay = effectiveRemainingDays;
    remainingCalendarDays = calDays;
  }

  const finalAmount = Number(Math.max(0, targetPrice - deductAmount).toFixed(2));
  const gstAmount = Number((finalAmount * GST_RATE).toFixed(2));
  const grandTotal = Number((finalAmount + gstAmount).toFixed(2));

  return {
    canUpgrade: true,
    currentPlan: {
      id: currentPlan?.id ?? null,
      name: currentPlan?.name ?? activeMembership.membership_type,
      slug: activeMembership.membership_type,
      price: currentPlan ? Number(currentPlan.price) : 0,
      remainingDays: remainingDaysForDisplay,
      ...(remainingCalendarDays > remainingDaysForDisplay
        ? { remainingCalendarDays }
        : {}),
      remainingAmount: deductAmount,
    },
    targetPlan: {
      id: targetPlan.id,
      name: targetPlan.name,
      price: targetPrice,
    },
    pricing: {
      targetAmount: targetPrice,
      deductAmount,
      finalAmount,
      gstAmount,
      grandTotal,
    },
  };
}

module.exports = { calculateMembershipUpgrade };
