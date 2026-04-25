const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'FileCategory',
    {
      file_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      file_cat_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
    },
    {
      tableName: 'file_categories',
      underscored: true,
      timestamps: false,
    }
  );
};
