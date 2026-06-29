const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ArticleSection = sequelize.define(
    'ArticleSection',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      article_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      title: { type: DataTypes.TEXT, allowNull: true },
      content: { type: DataTypes.TEXT('long'), allowNull: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'article_sections',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  ArticleSection.associate = (models) => {
    ArticleSection.belongsTo(models.Article, { foreignKey: 'article_id' });
  };
  return ArticleSection;
};
