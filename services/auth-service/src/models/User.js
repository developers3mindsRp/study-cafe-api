const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define(
    'User',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, unique: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      password_hash: { type: DataTypes.STRING(255), allowNull: true },
      name: { type: DataTypes.STRING(255), allowNull: true },
      display_name: { type: DataTypes.STRING(250), allowNull: true },
      login: { type: DataTypes.STRING(60), allowNull: true },
      first_name: { type: DataTypes.STRING(100), allowNull: true },
      last_name: { type: DataTypes.STRING(100), allowNull: true },
      user_nicename: { type: DataTypes.STRING(50), allowNull: true },
      user_url: { type: DataTypes.STRING(500), allowNull: true },
      phone: { type: DataTypes.STRING(20), allowNull: true },
      profession: { type: DataTypes.STRING(200), allowNull: true },
      designation: { type: DataTypes.STRING(200), allowNull: true },
      company: { type: DataTypes.STRING(200), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      state: { type: DataTypes.STRING(100), allowNull: true },
      country: { type: DataTypes.STRING(100), allowNull: true },
      profile_pic_url: { type: DataTypes.STRING(500), allowNull: true },
      bio: { type: DataTypes.TEXT, allowNull: true },
      membership: { type: DataTypes.STRING(50), allowNull: true },
      plan: { type: DataTypes.TEXT, allowNull: true },
      role_id: { type: DataTypes.INTEGER, allowNull: true },
      role: { type: DataTypes.STRING(50), allowNull: true },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      status: { type: DataTypes.STRING(20), allowNull: true },
      permission_overrides: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
      facebook: { type: DataTypes.STRING(500), allowNull: true },
      twitter: { type: DataTypes.STRING(500), allowNull: true },
      linkedin: { type: DataTypes.STRING(500), allowNull: true },
      instagram: { type: DataTypes.STRING(500), allowNull: true },
      youtube: { type: DataTypes.STRING(500), allowNull: true },
      gst: { type: DataTypes.STRING(100), allowNull: true },
      account_status: { type: DataTypes.STRING(50), allowNull: true },
      referral_code: { type: DataTypes.STRING(32), allowNull: true, unique: true },
      referred_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      referred_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'users',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      defaultScope: { attributes: { exclude: ['password_hash'] } },
      scopes: {
        withPassword: { attributes: {} },
      },
    }
  );
  User.associate = (models) => {
    User.belongsTo(models.Role, { foreignKey: 'role_id' });
    User.hasMany(models.UserCourse, { foreignKey: 'user_id' });
    User.hasMany(models.UserMembership, { foreignKey: 'user_id' });
  };
  return User;
};
