const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'PaymentLink',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      title: { type: DataTypes.STRING(500), allowNull: false },
      slug: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT('long'), allowNull: true },
      amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      sale_price: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
      expiry: { type: DataTypes.DATE, allowNull: false },
      total_seats: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      /** Legacy DB column; always 0 — paid seat count comes from `orders` at read time. */
      seats_booked: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      /** e.g. "1-3" — random increment range applied on each public checkout page load */
      random_value: { type: DataTypes.STRING(32), allowNull: true },
      random_boost_accumulator: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
      },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    },
    {
      tableName: 'payment_links',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
