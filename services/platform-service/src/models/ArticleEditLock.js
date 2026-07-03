const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ArticleEditLock = sequelize.define(
    'ArticleEditLock',
    {
      article_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      user_name: { type: DataTypes.STRING(255), allowNull: true },
      locked_at: { type: DataTypes.DATE, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'article_edit_locks',
      underscored: true,
      // Rows are written via raw atomic upserts; locked_at covers the audit need.
      timestamps: false,
    }
  );
  return ArticleEditLock;
};
