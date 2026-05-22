const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'Media',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      title: { type: DataTypes.STRING(500), allowNull: true },
      label: { type: DataTypes.STRING(128), allowNull: true },
      url: { type: DataTypes.STRING(512), allowNull: true },
      mime_type: { type: DataTypes.STRING(128), allowNull: true },
      category: { type: DataTypes.STRING(64), allowNull: true, defaultValue: 'library' },
    },
    {
      tableName: 'media',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
};
