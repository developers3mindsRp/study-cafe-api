const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { logger } = require('../../../../shared');

const AFFILIATE_MIN_WITHDRAWAL_KEY = 'affiliate_min_withdrawal';
const AFFILIATE_EARNINGS_EXPIRY_DAYS_KEY = 'affiliate_earnings_expiry_days';

const DEFAULT_MIN_WITHDRAWAL = 1000;
const DEFAULT_EARNINGS_EXPIRY_DAYS = 90;

function parsePositiveNumber(raw, fallback) {
  const n = parseFloat(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function parsePositiveInt(raw, fallback) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

async function readSettingValue(key) {
  try {
    const rows = await sequelize.query(
      'SELECT setting_value FROM global_settings WHERE setting_key = :key LIMIT 1',
      { replacements: { key }, type: QueryTypes.SELECT },
    );
    return rows.length ? rows[0].setting_value : null;
  } catch (err) {
    const msg = String(err?.parent?.sqlMessage || err?.message || '');
    if (/global_settings/i.test(msg) && /doesn't exist/i.test(msg)) {
      logger.warn('[affiliateSettings] global_settings table missing; using defaults');
      return null;
    }
    throw err;
  }
}

const affiliateSettingsService = {
  DEFAULT_MIN_WITHDRAWAL,
  DEFAULT_EARNINGS_EXPIRY_DAYS,
  AFFILIATE_MIN_WITHDRAWAL_KEY,
  AFFILIATE_EARNINGS_EXPIRY_DAYS_KEY,

  async getMinWithdrawal() {
    const raw = await readSettingValue(AFFILIATE_MIN_WITHDRAWAL_KEY);
    const value = parsePositiveNumber(raw, DEFAULT_MIN_WITHDRAWAL);
    return value > 0 ? value : DEFAULT_MIN_WITHDRAWAL;
  },

  async getEarningsExpiryDays() {
    const raw = await readSettingValue(AFFILIATE_EARNINGS_EXPIRY_DAYS_KEY);
    return parsePositiveInt(raw, DEFAULT_EARNINGS_EXPIRY_DAYS);
  },

  async getSettings() {
    const [minWithdrawal, earningsExpiryDays] = await Promise.all([
      this.getMinWithdrawal(),
      this.getEarningsExpiryDays(),
    ]);
    return { minWithdrawal, earningsExpiryDays };
  },
};

module.exports = affiliateSettingsService;
