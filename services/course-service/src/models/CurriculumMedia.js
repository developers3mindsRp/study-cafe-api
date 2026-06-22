const { DataTypes } = require('sequelize');

/**
 * Read-only projection of the `media` table (owned by platform-service).
 * Used only to hydrate curriculum file entries with URL + metadata.
 * Never write through this model.
 */
module.exports = (sequelize) => {
  return sequelize.define(
    'CurriculumMedia',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
      label: { type: DataTypes.STRING(128), allowNull: true },
      url: { type: DataTypes.STRING(512), allowNull: true },
      mime_type: { type: DataTypes.STRING(128), allowNull: true },
    },
    {
      tableName: 'media',
      underscored: true,
      timestamps: false,
    }
  );
};
