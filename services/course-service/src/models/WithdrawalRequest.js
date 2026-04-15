const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const WithdrawalRequest = sequelize.define(
    'WithdrawalRequest',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      affiliate_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
      status: {
        type: DataTypes.ENUM('pending', 'approved', 'rejected'),
        defaultValue: 'pending',
      },
      remarks: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'withdrawal_requests',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return WithdrawalRequest;
};
