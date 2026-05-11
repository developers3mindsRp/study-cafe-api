const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'ArticleCategory',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(100), allowNull: false },
      slug: { type: DataTypes.STRING(100), allowNull: false, unique: true },
      sort_order: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      whatsapp_links: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
      telegram_links: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
      google_news_url: { type: DataTypes.STRING(500), allowNull: true },
    },
    {
      tableName: 'article_categories',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
};
