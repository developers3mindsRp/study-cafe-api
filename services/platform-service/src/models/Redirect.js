const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'Redirect',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      old_path: {
        type: DataTypes.STRING(1000),
        allowNull: false,
        unique: true,
      },
      new_path: {
        type: DataTypes.STRING(1000),
        allowNull: false,
      },
      redirect_type: {
        type: DataTypes.ENUM('301', '302'),
        allowNull: false,
        defaultValue: '301',
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: 'redirects',
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
