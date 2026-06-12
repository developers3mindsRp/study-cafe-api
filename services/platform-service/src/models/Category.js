const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    return sequelize.define('Category', {
        id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
        wp_term_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        name: { type: DataTypes.STRING(200), allowNull: false },
        slug: { type: DataTypes.STRING(200), allowNull: true },
        parent_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
        description: { type: DataTypes.TEXT, allowNull: true },
        image_url: { type: DataTypes.STRING(500), allowNull: true },
        whatsapp_links: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
        telegram_links: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
        google_news_url: { type: DataTypes.STRING(500), allowNull: true },
    }, { tableName: 'categories', underscored: true, timestamps: false });
};
