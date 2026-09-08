const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define(
        'UserCourse',
        {
            user_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
            course_id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true },
            order_id: { type: DataTypes.STRING(128), allowNull: true },
            // Set when an admin deallots the course; NULL = active grant. See
            // ensure-user-courses-revoked-at.js for why the row is kept, not deleted.
            revoked_at: { type: DataTypes.DATE, allowNull: true },
        },
        {
            tableName: 'user_courses',
            underscored: true,
            timestamps: false,
        }
    );
};
