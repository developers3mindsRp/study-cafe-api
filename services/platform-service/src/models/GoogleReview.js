const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'GoogleReview',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      role: { type: DataTypes.STRING(128), allowNull: true },
      quote: { type: DataTypes.TEXT, allowNull: false },
      rating: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true, defaultValue: 5 },
      reviewed_at: { type: DataTypes.STRING(64), allowNull: true },
      avatar_url: { type: DataTypes.STRING(512), allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'google_reviews',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    },
  );
};
