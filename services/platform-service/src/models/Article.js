const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Article = sequelize.define(
    'Article',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, unique: true },
      title: { type: DataTypes.TEXT, allowNull: false },
      slug: { type: DataTypes.STRING(200), allowNull: true },
      content: { type: DataTypes.TEXT('long'), allowNull: true },
      excerpt: { type: DataTypes.TEXT, allowNull: true },
      sub_heading: { type: DataTypes.TEXT, allowNull: true },
      author_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      thumbnail_url: { type: DataTypes.STRING(500), allowNull: true },
      views: { type: DataTypes.INTEGER.UNSIGNED, defaultValue: 0 },
      meta_title: { type: DataTypes.STRING(500), allowNull: true },
      meta_description: { type: DataTypes.TEXT, allowNull: true },
      meta_keywords: { type: DataTypes.STRING(500), allowNull: true },
      case_name: { type: DataTypes.TEXT, allowNull: true },
      citation: { type: DataTypes.TEXT, allowNull: true },
      appeal_number: { type: DataTypes.STRING(500), allowNull: true },
      judgement_date: { type: DataTypes.STRING(100), allowNull: true },
      assessment_year: { type: DataTypes.STRING(50), allowNull: true },
      court_name: { type: DataTypes.STRING(300), allowNull: true },
      section: { type: DataTypes.TEXT, allowNull: true },
      noti_no: { type: DataTypes.STRING(200), allowNull: true },
      noti_date: { type: DataTypes.STRING(100), allowNull: true },
      ext_link: { type: DataTypes.STRING(500), allowNull: true },
      upload_url: { type: DataTypes.STRING(500), allowNull: true },
      rel_download_url: { type: DataTypes.STRING(500), allowNull: true },
      external_links: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.STRING(20), defaultValue: 'publish' },
      published_at: { type: DataTypes.DATE, allowNull: true },
      /** `free` = full content for everyone; `premium` = full content only for members (or admins). */
      blog_access_tier: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'free' },
    },
    {
      tableName: 'articles',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  Article.associate = (models) => {
    Article.hasMany(models.Comment, { foreignKey: 'article_id' });
    Article.belongsToMany(models.Category, { through: models.ArticleCategoryMap, foreignKey: 'article_id', otherKey: 'category_id' });
    Article.belongsToMany(models.Tag, { through: models.ArticleTagMap, foreignKey: 'article_id', otherKey: 'tag_id' });
    Article.belongsToMany(models.ArticleType, { through: models.ArticleTypeMap, foreignKey: 'article_id', otherKey: 'article_type_id' });
    Article.belongsToMany(models.Court, { through: models.ArticleCourtMap, foreignKey: 'article_id', otherKey: 'court_id' });
  };
  return Article;
};
