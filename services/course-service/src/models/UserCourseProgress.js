const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const UserCourseProgress = sequelize.define(
    'UserCourseProgress',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      session_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      batch_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      status: {
        type: DataTypes.ENUM('in_progress', 'completed'),
        allowNull: false,
        defaultValue: 'in_progress',
      },
      watch_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      duration_seconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'user_course_progress',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  return UserCourseProgress;
};
