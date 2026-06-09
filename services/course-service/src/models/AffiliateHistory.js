const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const AffiliateHistory = sequelize.define(
    'AffiliateHistory',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      entity_type: { type: DataTypes.STRING(32), allowNull: true, defaultValue: 'course' },
      entity_id: { type: DataTypes.STRING(64), allowNull: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      affiliate_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      order_id: { type: DataTypes.STRING(128), allowNull: true, unique: true },
      order_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      commission_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status: {
        type: DataTypes.ENUM('pending', 'confirmed', 'expired'),
        defaultValue: 'confirmed',
      },
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
