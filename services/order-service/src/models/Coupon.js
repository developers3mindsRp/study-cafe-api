const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define(
        'Coupon',
        {
            id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
            wp_post_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
            code: { type: DataTypes.STRING(100), allowNull: false },
            description: { type: DataTypes.TEXT, allowNull: true },
            type: { type: DataTypes.STRING(20), allowNull: true },
            value: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
            min_order: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
            max_discount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
            discount_on: { type: DataTypes.STRING(50), allowNull: true },
            start_date: { type: DataTypes.DATE, allowNull: true },
            expire_date: { type: DataTypes.DATE, allowNull: true },
            status: { type: DataTypes.STRING(20), allowNull: true },
            visibility: { type: DataTypes.ENUM('public', 'hidden'), allowNull: false, defaultValue: 'public' },
            usage_limit: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
            per_user_limit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        },
        {
            tableName: 'coupons',
            underscored: true,
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: false,
        }
    );
};
