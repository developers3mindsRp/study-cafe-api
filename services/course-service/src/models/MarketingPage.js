const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MarketingPage = sequelize.define(
    'MarketingPage',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      slug: { type: DataTypes.STRING(200), allowNull: false },
      is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      meta: { type: DataTypes.TEXT('long'), allowNull: true },
    },
    {
      tableName: 'marketing_pages',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  );

  MarketingPage.associate = (models) => {
    MarketingPage.belongsTo(models.Course, { foreignKey: 'course_id', as: 'Course' });
  };

  return MarketingPage;
};
