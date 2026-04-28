const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const CourseReview = sequelize.define(
    'CourseReview',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      rating: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
      body: { type: DataTypes.TEXT, allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'course_reviews',
      timestamps: false,
      underscored: true,
    }
  );
  return CourseReview;
};
