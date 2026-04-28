const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const SeoMetadata = sequelize.define('SeoMetadata', {
        id: {
            type: DataTypes.INTEGER,
            autoIncrement: true,
            primaryKey: true,
        },
        page_name: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        page_slug: {
            type: DataTypes.STRING(255),
            allowNull: false,
            unique: true,
        },
        meta_title: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        meta_description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        meta_keywords: {
            type: DataTypes.STRING(500),
            allowNull: true,
        },
        canonical_url: {
            type: DataTypes.STRING(1000),
            allowNull: true,
        },
        og_title: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        og_description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        og_image_url: {
            type: DataTypes.STRING(1000),
            allowNull: true,
        },
        robots: {
            type: DataTypes.STRING(255),
            allowNull: true,
            defaultValue: 'index, follow',
        },
    }, {
        tableName: 'seo_metadata',
        timestamps: true,
        createdAt: 'created_at',
        updatedAt: 'updated_at',
    });

    return SeoMetadata;
};
