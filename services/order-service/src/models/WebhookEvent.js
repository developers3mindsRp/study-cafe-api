const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'WebhookEvent',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      event_id: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      event_type: { type: DataTypes.STRING(64), allowNull: false },
      razorpay_order_id: { type: DataTypes.STRING(128), allowNull: true },
      razorpay_payment_id: { type: DataTypes.STRING(128), allowNull: true },
      payload: { type: DataTypes.JSON, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'received' },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      processed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'webhook_events',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
};
