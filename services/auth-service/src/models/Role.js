const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Role = sequelize.define(
    'Role',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(64), allowNull: false },
      description: { type: DataTypes.STRING(255), allowNull: true },
      permissions: { type: DataTypes.JSON, allowNull: true },
      is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      is_admin_panel: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    },
    { tableName: 'roles', underscored: true, timestamps: false }
  );
  Role.associate = (models) => {
    Role.hasMany(models.User, { foreignKey: 'role_id' });
  };
  return Role;
};
