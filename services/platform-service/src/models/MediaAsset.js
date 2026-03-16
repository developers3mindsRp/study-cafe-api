const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'MediaAsset',
    {
      id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      url:      { type: DataTypes.STRING(512), allowNull: false },
      label:    { type: DataTypes.STRING(128), allowNull: true },
      category: { type: DataTypes.STRING(64),  allowNull: true, defaultValue: 'icon' },
    },
    {
      tableName: 'media_assets',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
};
