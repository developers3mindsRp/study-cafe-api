const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'PaymentConfig',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      razorpay_key_id: { type: DataTypes.STRING(512), allowNull: true },
      razorpay_key_secret: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName: 'payment_config',
      underscored: true,
      timestamps: false,
    }
  );
};
