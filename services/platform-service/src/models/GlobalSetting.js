const { DataTypes } = require('sequelize');

/** Site-wide key/value store (tracking snippets, display ads JSON, future flags). */
module.exports = (sequelize) => {
  return sequelize.define(
    'GlobalSetting',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      setting_key: { type: DataTypes.STRING(128), allowNull: false, unique: true },
      setting_value: { type: DataTypes.TEXT('long'), allowNull: true },
      meta: { type: DataTypes.JSON, allowNull: true },
    },
    {
      tableName: 'global_settings',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  );
};
