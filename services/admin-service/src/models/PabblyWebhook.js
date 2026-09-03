const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'PabblyWebhook',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      name: { type: DataTypes.STRING(255), allowNull: false },
      webhook_url: { type: DataTypes.STRING(1024), allowNull: false },
      // Course category ids this rule matches. An empty array is a catch-all —
      // it matches every course purchase that no more specific rule already claimed.
      category_ids: {
        type: DataTypes.JSON,
        allowNull: false,
        defaultValue: [],
      },
      // Lower runs first. First matching rule wins — a purchase never fires more
      // than one Pabbly webhook.
      priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    {
      tableName: 'pabbly_webhooks',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
