const { DataTypes } = require('sequelize');

/** Read-only mirror of auth-service `user_memberships` (same DB) for article access checks. */
module.exports = (sequelize) =>
  sequelize.define(
    'UserMembership',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      membership_type: { type: DataTypes.STRING(64), allowNull: false },
      order_id: { type: DataTypes.STRING(128), allowNull: true },
      starts_at: { type: DataTypes.DATE, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'user_memberships',
      underscored: true,
      timestamps: false,
    }
  );
