const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define(
        'UserCourse',
        {
            user_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
            course_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
            order_id: { type: DataTypes.STRING(128), allowNull: true },
        },
        {
            tableName: 'user_courses',
            underscored: true,
            timestamps: false,
        }
    );
};
