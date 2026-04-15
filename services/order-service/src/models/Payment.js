const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Payment = sequelize.define(
    'Payment',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      order_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      razorpay_payment_id: { type: DataTypes.STRING(128), allowNull: false },
      razorpay_signature: { type: DataTypes.STRING(255), allowNull: true },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      source: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'checkout' },
    },
    {
      tableName: 'payments',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  Payment.associate = (models) => {
    Payment.belongsTo(models.Order, { foreignKey: 'order_id' });
  };
  return Payment;
};
