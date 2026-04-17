const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Order = sequelize.define(
    'Order',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, unique: true },
      order_id: { type: DataTypes.STRING(128), allowNull: true, unique: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      type: { type: DataTypes.STRING(32), allowNull: true },
      entity_id: { type: DataTypes.STRING(64), allowNull: true },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
      buyer_name: { type: DataTypes.STRING(250), allowNull: true },
      buyer_email: { type: DataTypes.STRING(255), allowNull: true },
      buyer_mobile: { type: DataTypes.STRING(20), allowNull: true },
      rp_payment_id: { type: DataTypes.STRING(100), allowNull: true },
      razorpay_order_id: { type: DataTypes.STRING(128), allowNull: true },
      coupon_code: { type: DataTypes.STRING(100), allowNull: true },
      coupon_discount: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: 0 },
      original_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      affiliate: { type: DataTypes.STRING(200), allowNull: true },
      certificate_name: { type: DataTypes.STRING(300), allowNull: true },
      certificate_issue_date: { type: DataTypes.STRING(50), allowNull: true },
      status: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'pending' },
      gateway: { type: DataTypes.STRING(50), allowNull: true },
    },
    {
      tableName: 'orders',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  Order.associate = (models) => {
    Order.hasMany(models.Payment, { foreignKey: 'order_id' });
  };
  return Order;
};
