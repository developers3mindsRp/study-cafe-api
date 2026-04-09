const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'PlanFeatureAvailability',
    {
      plan_id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
      feature_id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true },
      available: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'plan_feature_availability',
      underscored: true,
      timestamps: false,
    }
  );
};
