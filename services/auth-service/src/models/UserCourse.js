const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'UserCourse',
    {
      user_id: { type: DataTypes.INTEGER, primaryKey: true },
      course_id: { type: DataTypes.INTEGER, primaryKey: true },
      order_id: { type: DataTypes.STRING(128), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'user_courses',
      underscored: true,
      timestamps: false,
    }
  );
};
