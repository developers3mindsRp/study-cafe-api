const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AffiliateHistory = sequelize.define(
    'AffiliateHistory',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      affiliate_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.STRING(128), allowNull: true },
      commission_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
    },
    {
      tableName: 'affiliate_history',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return AffiliateHistory;
};
