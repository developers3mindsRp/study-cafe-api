const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'PremiumPlan',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      slug: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR' },
      duration_days: { type: DataTypes.INTEGER, allowNull: true },
      is_lifetime: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      features: { type: DataTypes.JSON, allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      is_popular: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    {
      tableName: 'premium_plans',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
