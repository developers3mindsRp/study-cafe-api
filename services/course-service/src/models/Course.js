const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Course = sequelize.define(
    'Course',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, unique: true },
      title: { type: DataTypes.STRING(500), allowNull: false, defaultValue: '' },
      short_title: { type: DataTypes.STRING(500), allowNull: true },
      slug: { type: DataTypes.STRING(200), allowNull: true },
      brief_description: { type: DataTypes.TEXT, allowNull: true },
      description: { type: DataTypes.TEXT('long'), allowNull: true },
      curriculum: { type: DataTypes.TEXT('long'), allowNull: true },
      learn_outcomes: { type: DataTypes.TEXT, allowNull: true },
      requirements: { type: DataTypes.TEXT, allowNull: true },
      terms_conditions: { type: DataTypes.TEXT, allowNull: true },
      price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      sale_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
      enrolled_count: { type: DataTypes.INTEGER, defaultValue: 0 },
      ratings: { type: DataTypes.DECIMAL(3, 2), allowNull: true },
      rating_users: { type: DataTypes.INTEGER, defaultValue: 0 },
      thumbnail_url: { type: DataTypes.STRING(500), allowNull: true },
      youtube_url: { type: DataTypes.STRING(500), allowNull: true },
      language: { type: DataTypes.TEXT, allowNull: true },
      course_type: { type: DataTypes.STRING(50), allowNull: true },
      taxable: { type: DataTypes.BOOLEAN, defaultValue: false },
      keywords: { type: DataTypes.STRING(500), allowNull: true },
      faqs: { type: DataTypes.TEXT('long'), allowNull: true },
      feedback: { type: DataTypes.TEXT('long'), allowNull: true },
      includes_info: { type: DataTypes.TEXT('long'), allowNull: true },
      /** JSON [{ image, title }] — banner "This course includes" (not bonuses). */
      course_includes: { type: DataTypes.TEXT('long'), allowNull: true },
      certifications: { type: DataTypes.TEXT, allowNull: true },
      gateway: { type: DataTypes.STRING(200), allowNull: true },
      is_published: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      /** When true, course is excluded from public listings and marketing pages unless the viewer has course access. */
      hide_from_public: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      status: { type: DataTypes.STRING(20), defaultValue: 'draft' },
      start_date: { type: DataTypes.DATE, allowNull: true },
      end_date: { type: DataTypes.DATE, allowNull: true },
      affiliate_commission: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    },
    {
      tableName: 'courses',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
  Course.associate = (models) => {
    Course.hasMany(models.Batch, { foreignKey: 'course_id' });
    Course.hasMany(models.Material, { foreignKey: 'course_id' });
    Course.hasMany(models.CourseAuthor, { foreignKey: 'course_id' });
    Course.hasMany(models.Enrollment, { foreignKey: 'course_id', as: 'Enrollments' });
    Course.belongsToMany(models.CourseCat, { through: models.CourseCategory, foreignKey: 'course_id', otherKey: 'course_cat_id' });
  };
  return Course;
};
