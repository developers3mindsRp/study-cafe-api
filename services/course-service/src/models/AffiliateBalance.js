const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AffiliateBalance = sequelize.define(
    'AffiliateBalance',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      affiliate_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, unique: true },
      total_earned: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
      total_withdrawn: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
      current_balance: { type: DataTypes.DECIMAL(10, 2), defaultValue: 0.00 },
    },
    {
      tableName: 'affiliate_balances',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return AffiliateBalance;
};
