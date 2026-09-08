const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'UserCourse',
    {
      user_id: { type: DataTypes.INTEGER, primaryKey: true },
      course_id: { type: DataTypes.INTEGER, primaryKey: true },
      order_id: { type: DataTypes.STRING(128), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: true },
      // Set when an admin deallots the course. The row is kept rather than deleted so
      // "removed by an admin" stays distinguishable from "the grant never landed" — the
      // outbox worker writes grants asynchronously, so a missing row is a normal state.
      revoked_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'user_courses',
      underscored: true,
      timestamps: false,
    }
  );
};
