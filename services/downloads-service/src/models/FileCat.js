const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FileCat = sequelize.define(
    'FileCat',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_term_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      name: { type: DataTypes.STRING(200), allowNull: false },
      slug: { type: DataTypes.STRING(200), allowNull: true },
    },
    {
      tableName: 'file_cats',
      underscored: true,
      timestamps: false,
    }
  );

  FileCat.associate = (models) => {
    FileCat.belongsToMany(models.File, {
      through: models.FileCategory,
      foreignKey: 'file_cat_id',
      otherKey: 'file_id',
    });
  };

  return FileCat;
};
