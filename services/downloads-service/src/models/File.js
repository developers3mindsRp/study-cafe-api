const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const File = sequelize.define(
    'File',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, unique: true },
      title: { type: DataTypes.STRING(500), allowNull: false },
      slug: { type: DataTypes.STRING(200), allowNull: true },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      author_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      views: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'publish' },
      meta_title: { type: DataTypes.TEXT, allowNull: true },
      meta_description: { type: DataTypes.TEXT, allowNull: true },
      meta_keywords: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      tableName: 'files',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  File.associate = (models) => {
    File.belongsToMany(models.FileCat, {
      through: models.FileCategory,
      foreignKey: 'file_id',
      otherKey: 'file_cat_id',
    });
  };

  return File;
};
