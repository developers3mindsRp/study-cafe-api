const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'Coupon',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      code: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      type: { type: DataTypes.STRING(20), allowNull: true },
      value: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      min_order: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      max_discount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      discount_on: { type: DataTypes.STRING(50), allowNull: true },
      start_date: { type: DataTypes.DATE, allowNull: true },
      expire_date: { type: DataTypes.DATE, allowNull: true },
      status: { type: DataTypes.STRING(20), allowNull: true },
    },
    {
      tableName: 'coupons',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
};
