const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define(
        'CourseCat',
        {
            id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
            wp_term_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
            name: { type: DataTypes.STRING(200), allowNull: false },
            slug: { type: DataTypes.STRING(200), allowNull: true },
            is_featured: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        },
        {
            tableName: 'course_cats',
            underscored: true,
            timestamps: false,
        }
    );
};
