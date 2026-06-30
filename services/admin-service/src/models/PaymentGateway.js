const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'PaymentGateway',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      gateway_name: { type: DataTypes.STRING(50), allowNull: false, defaultValue: 'razorpay' },
      key_id: { type: DataTypes.STRING(512), allowNull: false },
      key_secret: { type: DataTypes.STRING(512), allowNull: false },
      webhook_secret: { type: DataTypes.STRING(512), allowNull: true },
      is_active: { type: DataTypes.TINYINT(1), allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'payment_gateways',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
