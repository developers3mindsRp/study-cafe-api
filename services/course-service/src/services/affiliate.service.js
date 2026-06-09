const { 
  AffiliateHistory, 
  WithdrawalRequest, 
  AffiliateBalance, 
  Course,
  sequelize 
} = require("../models");
const { QueryTypes, Op } = require("sequelize");
const { logger } = require("../../../../shared");
const { notifyWithdrawalEmail } = require("./withdrawalEmail.service");
const affiliateSettingsService = require("./affiliateSettings.service");

/** Match order-service normalization: trim + uppercase (referral hex codes are stored uppercase). */
function normalizeReferralCodeInput(code) {
  if (code == null) return "";
  const s = String(code).trim();
  if (!s) return "";
  return s.toUpperCase();
}

async function sumPendingWithdrawals(affiliateNumericId) {
  const raw = await WithdrawalRequest.sum("amount", {
    where: { affiliate_id: affiliateNumericId, status: "pending" },
  });
  return Math.round((parseFloat(raw || 0) || 0) * 100) / 100;
}

function computeExpiresAt(createdAt, expiryDays) {
  if (!expiryDays || expiryDays <= 0 || !createdAt) return null;
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + expiryDays);
  return d.toISOString();
}

function enrichHistoryRow(record, expiryDays) {
  const expiryDate = computeExpiresAt(record.created_at, expiryDays);
  return {
    ...record,
    expires_at:
      record.status === 'confirmed' || record.status === 'expired'
        ? expiryDate
        : null,
  };
}

function summarizeCommissionHistory(enriched) {
  let expiredCommissionTotal = 0;
  let activeCommissionTotal = 0;
  let nextExpiryAt = null;

  for (const row of enriched) {
    const amt = parseFloat(row.commission_amount) || 0;
    if (row.status === 'expired') {
      expiredCommissionTotal += amt;
      continue;
    }
    if (row.status !== 'confirmed') continue;
    activeCommissionTotal += amt;
    if (!row.expires_at) continue;
    const expMs = new Date(row.expires_at).getTime();
    if (Number.isNaN(expMs)) continue;
    if (nextExpiryAt == null || expMs < nextExpiryAt) nextExpiryAt = expMs;
  }

  return {
    expired_commission_total: Math.round(expiredCommissionTotal * 100) / 100,
    active_commission_total: Math.round(activeCommissionTotal * 100) / 100,
    next_expiry_at: nextExpiryAt != null ? new Date(nextExpiryAt).toISOString() : null,
  };
}

function isExpiredStatusEnumError(err) {
  const msg = String(err?.parent?.sqlMessage || err?.message || '');
  return /expired/i.test(msg) && /enum|Data truncated|incorrect/i.test(msg);
}

const affiliateService = {
  /**
   * Expire confirmed commissions older than the configured validity window.
   */
  async expireStaleEarnings(affiliateId) {
    const uid = Number(affiliateId);
    if (!Number.isFinite(uid)) return { expiredCount: 0, expiredAmount: 0 };

    const expiryDays = await affiliateSettingsService.getEarningsExpiryDays();
    if (!expiryDays || expiryDays <= 0) return { expiredCount: 0, expiredAmount: 0 };

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - expiryDays);

    const t = await sequelize.transaction();
    try {
      const stale = await AffiliateHistory.findAll({
        where: {
          affiliate_id: uid,
          status: 'confirmed',
          created_at: { [Op.lt]: cutoff },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!stale.length) {
        await t.commit();
        return { expiredCount: 0, expiredAmount: 0 };
      }

      let totalExpired = 0;
      for (const row of stale) {
        const amt = parseFloat(row.commission_amount) || 0;
        await row.update({ status: 'expired' }, { transaction: t });
        if (amt > 0) totalExpired += amt;
      }
      totalExpired = Math.round(totalExpired * 100) / 100;

      if (totalExpired > 0) {
        const [balance] = await AffiliateBalance.findOrCreate({
          where: { affiliate_id: uid },
          defaults: { affiliate_id: uid, total_earned: 0, total_withdrawn: 0, current_balance: 0 },
          transaction: t,
        });
        const newBal = Math.max(
          0,
          Math.round((parseFloat(balance.current_balance) - totalExpired) * 100) / 100,
        );
        await balance.update({ current_balance: newBal }, { transaction: t });
      }

      await t.commit();
      if (totalExpired > 0) {
        logger.info(
          `[expireStaleEarnings] affiliateId=${uid} expiredAmount=${totalExpired} rows=${stale.length}`,
        );
      }
      return { expiredCount: stale.length, expiredAmount: totalExpired };
    } catch (err) {
      await t.rollback();
      if (isExpiredStatusEnumError(err)) {
        logger.warn(
          '[expireStaleEarnings] affiliate_history.status missing expired — restart course-service after schema ensure',
        );
        return { expiredCount: 0, expiredAmount: 0 };
      }
      throw err;
    }
  },

  /**
   * Fetch affiliate history with details.
   */
  async getHistory() {
    const history = await AffiliateHistory.findAll({
      order: [["created_at", "DESC"]],
      // We can't easily join User since it's in another service, 
      // but in this setup, the users table seems accessible in the same DB.
    });

    if (history.length === 0) return [];

    const userIds = [...new Set([
      ...history.map(h => h.user_id),
      ...history.map(h => h.affiliate_id)
    ])];
    
    const courseIds = [...new Set(history.map(h => h.course_id))];

    // Fetch users for names
    const users = await sequelize.query(
      `SELECT id, name, email FROM users WHERE id IN (:userIds)`,
      {
        replacements: { userIds },
        type: QueryTypes.SELECT,
      }
    );
    const userMap = new Map(users.map(u => [Number(u.id), u]));

    // Fetch courses for titles
    const courses = await Course.findAll({
      where: { id: courseIds },
      attributes: ['id', 'title']
    });
    const courseMap = new Map(courses.map(c => [Number(c.id), c]));

    return history.map(h => {
      const record = h.get({ plain: true });
      const buyer = userMap.get(Number(record.user_id)) || {};
      const affiliate = userMap.get(Number(record.affiliate_id)) || {};
      const course = courseMap.get(Number(record.course_id)) || {};
      
      return {
        ...record,
        buyer_name: buyer.name || 'Unknown',
        affiliate_name: affiliate.name || 'Unknown',
        course_title: course.title || 'Unknown Course'
      };
    });
  },

  /**
   * Fetch withdrawal requests.
   */
  async getWithdrawals() {
    const requests = await WithdrawalRequest.findAll({
      order: [["created_at", "DESC"]]
    });

    if (requests.length === 0) return [];

    const affiliateIds = [...new Set(requests.map(r => r.affiliate_id))];

    const users = await sequelize.query(
      `SELECT id, name, email FROM users WHERE id IN (:affiliateIds)`,
      {
        replacements: { affiliateIds },
        type: QueryTypes.SELECT,
      }
    );
    const userMap = new Map(users.map(u => [Number(u.id), u]));

    return requests.map(r => {
      const record = r.get({ plain: true });
      const user = userMap.get(Number(record.affiliate_id)) || {};
      return {
        ...record,
        affiliate_name: user.name || 'Unknown',
        affiliate_email: user.email || ''
      };
    });
  },

  /**
   * Get balance for an affiliate.
   */
  async getBalance(affiliateId) {
    const id = Number(affiliateId);
    if (!Number.isFinite(id)) {
      const err = new Error('Invalid affiliate id');
      err.statusCode = 400;
      throw err;
    }
    await this.expireStaleEarnings(id);
    const [balance] = await AffiliateBalance.findOrCreate({
      where: { affiliate_id: id },
      defaults: { affiliate_id: id, total_earned: 0, total_withdrawn: 0, current_balance: 0 }
    });
    return balance;
  },

  /**
   * Create a withdrawal request (user or admin).
   * Reserves against pending requests so available = current_balance − sum(pending).
   */
  async createWithdrawal(data, options = {}) {
    const affiliate_id = Number(data.affiliate_id);
    const amount = parseFloat(data.amount);
    if (!Number.isFinite(affiliate_id)) {
      const err = new Error("Invalid affiliate");
      err.statusCode = 400;
      throw err;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      const err = new Error("Amount must be greater than zero");
      err.statusCode = 400;
      throw err;
    }

    if (options.enforceMinWithdrawal) {
      const minWithdrawal = await affiliateSettingsService.getMinWithdrawal();
      if (amount + 1e-6 < minWithdrawal) {
        const err = new Error(`Minimum withdrawal amount is ₹${minWithdrawal.toFixed(2)}`);
        err.statusCode = 400;
        throw err;
      }
    }

    await this.expireStaleEarnings(affiliate_id);

    const balance = await AffiliateBalance.findOrCreate({
      where: { affiliate_id },
      defaults: { affiliate_id, total_earned: 0, total_withdrawn: 0, current_balance: 0 },
    }).then(([row]) => row);
    const pendingTotal = await sumPendingWithdrawals(affiliate_id);
    const current = parseFloat(balance.current_balance);
    const available = Math.round((current - pendingTotal) * 100) / 100;
    if (amount > available + 1e-6) {
      const err = new Error(
        available <= 0
          ? "No balance available (funds may be reserved for pending withdrawals)"
          : `Maximum you can request now is ₹${available.toFixed(2)}`
      );
      err.statusCode = 400;
      throw err;
    }

    const request = await WithdrawalRequest.create({
      affiliate_id,
      amount,
      status: "pending",
    });

    const plain = request.get({ plain: true });
    notifyWithdrawalEmail({
      affiliateId: affiliate_id,
      request: plain,
      status: 'created',
    }).catch((err) => {
      logger.warn('[createWithdrawal] email failed (non-blocking)', {
        requestId: plain.id,
        err: err?.message,
      });
    });

    return request;
  },

  /**
   * User-facing: withdrawal requests for one affiliate (newest first).
   */
  async getMyWithdrawals(affiliateId) {
    const uid = Number(affiliateId);
    if (!Number.isFinite(uid)) return [];
    const rows = await WithdrawalRequest.findAll({
      where: { affiliate_id: uid },
      order: [["created_at", "DESC"]],
      limit: 200,
    });
    return rows.map((r) => r.get({ plain: true }));
  },

  /**
   * Update withdrawal status and adjust balance if approved.
   */
  async updateWithdrawalStatus(id, { status, remarks }) {
    const request = await WithdrawalRequest.findByPk(id);
    if (!request) {
      const err = new Error('Withdrawal request not found');
      err.statusCode = 404;
      throw err;
    }

    if (request.status !== 'pending') {
       const err = new Error(`Cannot update request with status: ${request.status}`);
       err.statusCode = 400;
       throw err;
    }

    if (status === 'approved') {
      const balance = await this.getBalance(request.affiliate_id);
      
      await balance.update({
        total_withdrawn: parseFloat(balance.total_withdrawn) + parseFloat(request.amount),
        current_balance: parseFloat(balance.current_balance) - parseFloat(request.amount)
      });
    }

    await request.update({ status, remarks });
    const plain = request.get({ plain: true });

    if (status === 'approved' || status === 'rejected') {
      notifyWithdrawalEmail({
        affiliateId: request.affiliate_id,
        request: plain,
        status,
        remarks,
      }).catch((err) => {
        logger.warn('[updateWithdrawalStatus] email failed (non-blocking)', {
          requestId: plain.id,
          status,
          err: err?.message,
        });
      });
    }

    return request;
  },

  /**
   * Record a commission from a completed order (called by outbox worker).
   * Idempotent — skips if order_id already has a commission entry.
   */
  async recordCommission({ userId, orderId, type, entityId, amount, referralCode }) {
    const buyerId = Number(userId);
    if (!Number.isFinite(buyerId)) {
      logger.warn(`[recordCommission] skip invalid userId=${userId}`);
      return null;
    }

    const orderKey = orderId != null ? String(orderId) : "";
    const existing = orderKey
      ? await AffiliateHistory.findOne({ where: { order_id: orderKey } })
      : null;
    if (existing) return existing;

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      logger.warn(`[recordCommission] skip order=${orderKey} invalid amount=${amount}`);
      return null;
    }

    const code = normalizeReferralCodeInput(referralCode);
    if (!code) {
      logger.warn(`[recordCommission] skip order=${orderKey} empty referralCode`);
      return null;
    }

    const referrer = await sequelize.query(
      `SELECT id FROM users WHERE UPPER(TRIM(COALESCE(referral_code, ''))) = :code LIMIT 1`,
      { replacements: { code }, type: QueryTypes.SELECT }
    );
    if (!referrer.length) {
      logger.warn(`[recordCommission] skip order=${orderKey} no user for referral code (normalized)`);
      return null;
    }

    const affiliateId = Number(referrer[0].id);
    if (!Number.isFinite(affiliateId)) {
      logger.warn(`[recordCommission] skip order=${orderKey} invalid referrer id`);
      return null;
    }
    if (affiliateId === buyerId) {
      logger.warn(`[recordCommission] skip order=${orderKey} self-referral affiliateId=${affiliateId}`);
      return null;
    }

    let commissionAmount = 0;
    let courseId = null;

    if (type === 'course') {
      courseId = Number(entityId);
      if (!Number.isFinite(courseId)) {
        logger.warn(`[recordCommission] skip order=${orderKey} invalid course entityId=${entityId}`);
        return null;
      }
      const course = await Course.findByPk(courseId, { attributes: ['affiliate_commission'] });
      const pct = course ? parseFloat(course.affiliate_commission) : 0;
      commissionAmount = pct > 0 ? (amt * pct) / 100 : 0;
      if (commissionAmount <= 0) {
        logger.warn(
          `[recordCommission] skip order=${orderKey} courseId=${courseId} affiliate_commission pct=${pct} (set in admin)`
        );
        return null;
      }
    } else if (type === 'membership') {
      const planId = Number(entityId);
      if (!Number.isFinite(planId)) {
        logger.warn(`[recordCommission] skip order=${orderKey} invalid plan entityId=${entityId}`);
        return null;
      }
      let pct = 0;
      try {
        const planRows = await sequelize.query(
          `SELECT affiliate_commission FROM premium_plans WHERE id = :planId LIMIT 1`,
          { replacements: { planId }, type: QueryTypes.SELECT },
        );
        pct = planRows.length ? parseFloat(planRows[0].affiliate_commission) : 0;
      } catch (e) {
        logger.error(`[recordCommission] premium_plans query failed planId=${planId}: ${e.message}`);
        throw e;
      }
      commissionAmount = pct > 0 ? (amt * pct) / 100 : 0;
      if (commissionAmount <= 0) {
        logger.warn(
          `[recordCommission] skip order=${orderKey} planId=${planId} affiliate_commission pct=${pct} (set in admin / DB column)`
        );
        return null;
      }
    } else {
      logger.warn(`[recordCommission] skip order=${orderKey} unknown type=${type}`);
      return null;
    }

    commissionAmount = Math.round(commissionAmount * 100) / 100;

    const t = await sequelize.transaction();
    try {
      const record = await AffiliateHistory.create({
        course_id: courseId,
        entity_type: type,
        entity_id: String(entityId),
        user_id: buyerId,
        affiliate_id: affiliateId,
        order_id: orderKey,
        order_amount: amt,
        commission_amount: commissionAmount,
        status: 'confirmed',
      }, { transaction: t });

      const [balance] = await AffiliateBalance.findOrCreate({
        where: { affiliate_id: affiliateId },
        defaults: { affiliate_id: affiliateId, total_earned: 0, total_withdrawn: 0, current_balance: 0 },
        transaction: t,
      });
      await balance.update({
        total_earned: parseFloat(balance.total_earned) + commissionAmount,
        current_balance: parseFloat(balance.current_balance) + commissionAmount,
      }, { transaction: t });

      await t.commit();
      logger.info(
        `[recordCommission] credited order=${orderKey} affiliateId=${affiliateId} commission=${commissionAmount} type=${type}`
      );
      return record;
    } catch (err) {
      await t.rollback();
      if (err.name === 'SequelizeUniqueConstraintError') return null;
      throw err;
    }
  },

  /**
   * User-facing: get affiliate stats and history for a specific user.
   */
  async getMyAffiliateData(userId) {
    const uid = Number(userId);
    const settings = await affiliateSettingsService.getSettings();
    if (!Number.isFinite(uid)) {
      logger.warn(`[getMyAffiliateData] invalid userId=${userId}`);
      return {
        balance: { affiliate_id: null, total_earned: 0, total_withdrawn: 0, current_balance: 0 },
        pending_withdrawal_total: 0,
        available_for_withdrawal: 0,
        expired_commission_total: 0,
        active_commission_total: 0,
        next_expiry_at: null,
        totalOrders: 0,
        totalOrderValue: 0,
        totalCommission: 0,
        history: [],
        settings,
      };
    }

    await this.expireStaleEarnings(uid);

    const [balance] = await AffiliateBalance.findOrCreate({
      where: { affiliate_id: uid },
      defaults: { affiliate_id: uid, total_earned: 0, total_withdrawn: 0, current_balance: 0 },
    });

    const pendingWithdrawalTotal = await sumPendingWithdrawals(uid);
    const balPlain = balance.get({ plain: true });
    const currentBal = parseFloat(balPlain.current_balance || 0);
    const availableForWithdrawal = Math.max(
      0,
      Math.round((currentBal - pendingWithdrawalTotal) * 100) / 100
    );

    const history = await AffiliateHistory.findAll({
      where: { affiliate_id: uid },
      order: [['created_at', 'DESC']],
    });

    if (history.length === 0) {
      return {
        balance: balPlain,
        pending_withdrawal_total: pendingWithdrawalTotal,
        available_for_withdrawal: availableForWithdrawal,
        expired_commission_total: 0,
        active_commission_total: 0,
        next_expiry_at: null,
        totalOrders: 0,
        totalOrderValue: 0,
        totalCommission: parseFloat(balance.total_earned),
        history: [],
        settings,
      };
    }

    const buyerIds = [...new Set(history.map(h => h.user_id))];
    const courseIds = [...new Set(history.filter(h => h.course_id).map(h => h.course_id))];

    const users = await sequelize.query(
      `SELECT id, name, email, phone FROM users WHERE id IN (:buyerIds)`,
      { replacements: { buyerIds }, type: QueryTypes.SELECT }
    );
    const userMap = new Map(users.map(u => [Number(u.id), u]));

    let courseMap = new Map();
    if (courseIds.length) {
      const courses = await Course.findAll({
        where: { id: courseIds },
        attributes: ['id', 'title'],
      });
      courseMap = new Map(courses.map(c => [Number(c.id), c.title]));
    }

    const enriched = history.map(h => {
      const r = h.get({ plain: true });
      const buyer = userMap.get(Number(r.user_id)) || {};
      return enrichHistoryRow({
        ...r,
        buyer_name: buyer.name || 'Unknown',
        buyer_email: buyer.email ? buyer.email.replace(/(.{2}).*(@.*)/, '$1***$2') : '',
        buyer_phone: buyer.phone ? buyer.phone.replace(/(.{4}).*(.{3})/, '$1***$2') : '',
        item_title: r.entity_type === 'course'
          ? (courseMap.get(Number(r.course_id)) || 'Course')
          : 'Membership Plan',
      }, settings.earningsExpiryDays);
    });

    const activeHistory = enriched.filter((h) => h.status !== 'expired');
    const totalOrderValue = activeHistory.reduce((s, h) => s + parseFloat(h.order_amount || 0), 0);
    const summary = summarizeCommissionHistory(enriched);

    return {
      balance: balPlain,
      pending_withdrawal_total: pendingWithdrawalTotal,
      available_for_withdrawal: availableForWithdrawal,
      ...summary,
      totalOrders: activeHistory.length,
      totalOrderValue: Math.round(totalOrderValue * 100) / 100,
      totalCommission: parseFloat(balance.total_earned),
      history: enriched,
      settings,
    };
  },

  /**
   * User-facing: get commission history with date filtering.
   */
  async getMyCommissionOrders(userId, { from, to } = {}) {
    const uid = Number(userId);
    if (!Number.isFinite(uid)) return [];

    await this.expireStaleEarnings(uid);
    const settings = await affiliateSettingsService.getSettings();

    const where = { affiliate_id: uid };
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at[Op.gte] = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setHours(23, 59, 59, 999);
        where.created_at[Op.lte] = toDate;
      }
    }

    const history = await AffiliateHistory.findAll({
      where,
      order: [['created_at', 'DESC']],
    });

    if (!history.length) return [];

    const buyerIds = [...new Set(history.map(h => h.user_id))];
    const courseIds = [...new Set(history.filter(h => h.course_id).map(h => h.course_id))];

    const users = await sequelize.query(
      `SELECT id, name, email, phone FROM users WHERE id IN (:buyerIds)`,
      { replacements: { buyerIds }, type: QueryTypes.SELECT }
    );
    const userMap = new Map(users.map(u => [Number(u.id), u]));

    let courseMap = new Map();
    if (courseIds.length) {
      const courses = await Course.findAll({
        where: { id: courseIds },
        attributes: ['id', 'title'],
      });
      courseMap = new Map(courses.map(c => [Number(c.id), c.title]));
    }

    return history.map(h => {
      const r = h.get({ plain: true });
      const buyer = userMap.get(Number(r.user_id)) || {};
      return enrichHistoryRow({
        ...r,
        buyer_name: buyer.name || 'Unknown',
        buyer_email: buyer.email ? buyer.email.replace(/(.{2}).*(@.*)/, '$1***$2') : '',
        buyer_phone: buyer.phone ? buyer.phone.replace(/(.{4}).*(.{3})/, '$1***$2') : '',
        item_title: r.entity_type === 'course'
          ? (courseMap.get(Number(r.course_id)) || 'Course')
          : 'Membership Plan',
      }, settings.earningsExpiryDays);
    });
  },

  /**
   * Resolve a user's referral code — return the provided code if non-empty,
   * otherwise look it up from the users table, and generate + persist one if absent.
   */
  async resolveReferralCode(userId, headerCode) {
    if (headerCode && String(headerCode).trim()) return String(headerCode).trim();

    const rows = await sequelize.query(
      'SELECT referral_code FROM users WHERE id = :userId LIMIT 1',
      { replacements: { userId }, type: QueryTypes.SELECT }
    );
    if (rows.length && rows[0].referral_code) return rows[0].referral_code;

    // Auto-generate and persist
    const crypto = require('crypto');
    const newCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    await sequelize.query(
      'UPDATE users SET referral_code = :code WHERE id = :userId',
      { replacements: { code: newCode, userId }, type: QueryTypes.UPDATE }
    );
    return newCode;
  },

  /**
   * Generate referral links for a user based on available courses, categories, and memberships.
   */
  async getReferralLinks(userId, referralCode) {
    const { CourseCat } = require('../models');

    const courses = await Course.findAll({
      where: { is_published: true, status: 'publish' },
      attributes: ['id', 'title', 'slug', 'price', 'sale_price', 'brief_description', 'thumbnail_url'],
      order: [['created_at', 'DESC']],
    });

    const catAttrs = CourseCat.rawAttributes || {};
    const catImageAttr = catAttrs.image_url
      ? 'image_url'
      : catAttrs.thumbnail_url
        ? 'thumbnail_url'
        : null;
    const categoryAttrs = ['id', 'name', 'slug'];
    if (catImageAttr) categoryAttrs.push(catImageAttr);

    const categories = await CourseCat.findAll({
      attributes: categoryAttrs,
      order: [['name', 'ASC']],
    });

    const resolveImageUrl = (value) =>
      typeof value === 'string' && value.trim() ? value.trim() : null;

    return {
      referralCode,
      homepage: `?ref=${referralCode}`,
      membership: `/plans?ref=${referralCode}`,
      categories: categories.map(c => ({
        id: c.id,
        title: c.name,
        description: '',
        imageUrl: catImageAttr ? resolveImageUrl(c[catImageAttr]) : null,
        url: `/courses?category=${c.slug}&ref=${referralCode}`,
      })),
      courses: courses.map(c => ({
        id: c.id,
        title: c.title,
        description: c.brief_description || '',
        imageUrl: resolveImageUrl(c.thumbnail_url),
        originalPrice: parseFloat(c.price) || 0,
        discountedPrice:
          c.sale_price != null && c.sale_price !== ''
            ? parseFloat(c.sale_price)
            : parseFloat(c.price) || 0,
        url: `/course/${c.slug}?ref=${referralCode}`,
      })),
    };
  },
};

module.exports = affiliateService;
