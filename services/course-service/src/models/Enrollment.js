const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const Enrollment = sequelize.define(
        'Enrollment',
        {
            id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
            user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
            course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
            order_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
            enrolled_at: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: 'enrollments',
            underscored: true,
            timestamps: false,
        }
    );
    Enrollment.associate = (models) => {
        Enrollment.belongsTo(models.Course, { foreignKey: 'course_id', as: 'Course' });
    };
    return Enrollment;
};
