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
      /**
       * What a paid checkout on this link grants:
       *  'custom'     — nothing (money only; an admin assigns access by hand). Legacy default.
       *  'course'     — the course in product_id
       *  'membership' — the plan in product_id, with its linked courses
       */
      product_type: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'custom' },
      product_id: { type: DataTypes.STRING(64), allowNull: true },
      /** Course links only. NULL = resolve the purchase batch at checkout time. */
      batch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      /** Off = record the sale but withhold the grant (admin fulfils manually). */
      auto_enroll: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
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
