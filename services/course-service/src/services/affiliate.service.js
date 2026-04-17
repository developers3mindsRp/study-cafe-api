const { 
  AffiliateHistory, 
  WithdrawalRequest, 
  AffiliateBalance, 
  Course,
  sequelize 
} = require("../models");
const { QueryTypes, Op } = require("sequelize");

const MEMBERSHIP_COMMISSION_PERCENT = 10;

const affiliateService = {
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
    const [balance] = await AffiliateBalance.findOrCreate({
      where: { affiliate_id: affiliateId },
      defaults: { affiliate_id: affiliateId, total_earned: 0, total_withdrawn: 0, current_balance: 0 }
    });
    return balance;
  },

  /**
   * Create a withdrawal request.
   */
  async createWithdrawal(data) {
    const { affiliate_id, amount } = data;
    
    // Check balance
    const balance = await this.getBalance(affiliate_id);
    if (parseFloat(balance.current_balance) < parseFloat(amount)) {
      const err = new Error('Insufficient balance');
      err.statusCode = 400;
      throw err;
    }

    const request = await WithdrawalRequest.create({
      affiliate_id,
      amount,
      status: 'pending'
    });

    return request;
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
    return request;
  },

  /**
   * Record a commission from a completed order (called by outbox worker).
   * Idempotent — skips if order_id already has a commission entry.
   */
  async recordCommission({ userId, orderId, type, entityId, amount, referralCode }) {
    const existing = await AffiliateHistory.findOne({ where: { order_id: orderId } });
    if (existing) return existing;

    const referrer = await sequelize.query(
      `SELECT id FROM users WHERE referral_code = :code LIMIT 1`,
      { replacements: { code: referralCode }, type: QueryTypes.SELECT }
    );
    if (!referrer.length) return null;

    const affiliateId = referrer[0].id;
    if (String(affiliateId) === String(userId)) return null;

    let commissionAmount = 0;
    let courseId = null;

    if (type === 'course') {
      courseId = Number(entityId);
      const course = await Course.findByPk(courseId, { attributes: ['affiliate_commission'] });
      const pct = course ? parseFloat(course.affiliate_commission) : 0;
      commissionAmount = pct > 0 ? (amount * pct) / 100 : 0;
    } else if (type === 'membership') {
      commissionAmount = (amount * MEMBERSHIP_COMMISSION_PERCENT) / 100;
    }

    if (commissionAmount <= 0) return null;
    commissionAmount = Math.round(commissionAmount * 100) / 100;

    const t = await sequelize.transaction();
    try {
      const record = await AffiliateHistory.create({
        course_id: courseId,
        entity_type: type,
        entity_id: String(entityId),
        user_id: userId,
        affiliate_id: affiliateId,
        order_id: orderId,
        order_amount: amount,
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
    const [balance] = await AffiliateBalance.findOrCreate({
      where: { affiliate_id: userId },
      defaults: { affiliate_id: userId, total_earned: 0, total_withdrawn: 0, current_balance: 0 },
    });

    const history = await AffiliateHistory.findAll({
      where: { affiliate_id: userId },
      order: [['created_at', 'DESC']],
    });

    if (history.length === 0) {
      return {
        balance: balance.get({ plain: true }),
        totalOrders: 0,
        totalOrderValue: 0,
        totalCommission: parseFloat(balance.total_earned),
        history: [],
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
      return {
        ...r,
        buyer_name: buyer.name || 'Unknown',
        buyer_email: buyer.email ? buyer.email.replace(/(.{2}).*(@.*)/, '$1***$2') : '',
        buyer_phone: buyer.phone ? buyer.phone.replace(/(.{4}).*(.{3})/, '$1***$2') : '',
        item_title: r.entity_type === 'course'
          ? (courseMap.get(Number(r.course_id)) || 'Course')
          : 'Membership Plan',
      };
    });

    const totalOrderValue = enriched.reduce((s, h) => s + parseFloat(h.order_amount || 0), 0);

    return {
      balance: balance.get({ plain: true }),
      totalOrders: enriched.length,
      totalOrderValue: Math.round(totalOrderValue * 100) / 100,
      totalCommission: parseFloat(balance.total_earned),
      history: enriched,
    };
  },

  /**
   * User-facing: get commission history with date filtering.
   */
  async getMyCommissionOrders(userId, { from, to } = {}) {
    const where = { affiliate_id: userId };
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
      return {
        ...r,
        buyer_name: buyer.name || 'Unknown',
        buyer_email: buyer.email ? buyer.email.replace(/(.{2}).*(@.*)/, '$1***$2') : '',
        buyer_phone: buyer.phone ? buyer.phone.replace(/(.{4}).*(.{3})/, '$1***$2') : '',
        item_title: r.entity_type === 'course'
          ? (courseMap.get(Number(r.course_id)) || 'Course')
          : 'Membership Plan',
      };
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
    const courses = await Course.findAll({
      where: { is_published: true, status: 'publish' },
      attributes: ['id', 'title', 'slug', 'price', 'sale_price', 'brief_description'],
      order: [['created_at', 'DESC']],
    });

    const { CourseCat } = require('../models');
    const categories = await CourseCat.findAll({
      attributes: ['id', 'name', 'slug'],
      order: [['name', 'ASC']],
    });

    return {
      referralCode,
      homepage: `?ref=${referralCode}`,
      membership: `/plans?ref=${referralCode}`,
      categories: categories.map(c => ({
        id: c.id,
        title: c.name,
        description: '',
        url: `/courses?category=${c.slug}&ref=${referralCode}`,
      })),
      courses: courses.map(c => ({
        id: c.id,
        title: c.title,
        description: c.brief_description || '',
        originalPrice: parseFloat(c.price) || 0,
        discountedPrice: parseFloat(c.sale_price || c.price) || 0,
        url: `/course/${c.slug}?ref=${referralCode}`,
      })),
    };
  },
};

module.exports = affiliateService;
