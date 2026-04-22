const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'NewsletterSubscriber',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      email: { type: DataTypes.STRING(255), allowNull: false, unique: true },
      is_verified: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      unsubscribe_token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    },
    {
      tableName: 'newsletter_subscribers',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
