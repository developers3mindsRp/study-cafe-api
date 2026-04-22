const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'NewsletterTemplate',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      subject: { type: DataTypes.STRING(500), allowNull: false },
      html_content: { type: DataTypes.TEXT('long'), allowNull: false },
    },
    {
      tableName: 'newsletter_templates',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
