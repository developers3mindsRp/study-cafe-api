const { 
  AffiliateHistory, 
  WithdrawalRequest, 
  AffiliateBalance, 
  Course,
  sequelize 
} = require("../models");
const { QueryTypes, Op } = require("sequelize");

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

    // Only update if currently pending
    if (request.status !== 'pending') {
       const err = new Error(`Cannot update request with status: ${request.status}`);
       err.statusCode = 400;
       throw err;
    }

    if (status === 'approved') {
      const balance = await this.getBalance(request.affiliate_id);
      
      // Atomic-like update
      await balance.update({
        total_withdrawn: parseFloat(balance.total_withdrawn) + parseFloat(request.amount),
        current_balance: parseFloat(balance.current_balance) - parseFloat(request.amount)
      });
    }

    await request.update({ status, remarks });
    return request;
  }
};

module.exports = affiliateService;
