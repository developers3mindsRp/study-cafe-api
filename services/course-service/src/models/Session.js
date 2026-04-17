const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Session = sequelize.define(
    'Session',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      batch_id: { type: DataTypes.INTEGER, allowNull: false },
      day_number: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      section_index: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      title: { type: DataTypes.STRING(255), allowNull: true },
      section_title: { type: DataTypes.STRING(255), allowNull: true },
      duration: { type: DataTypes.INTEGER, allowNull: true },
      scheduled_at: { type: DataTypes.DATE, allowNull: true },
      meet_link: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName: 'sessions',
      underscored: true,
      timestamps: false,
    }
  );
  Session.associate = (models) => {
    Session.belongsTo(models.Batch, { foreignKey: 'batch_id' });
    Session.hasMany(models.Recording, { foreignKey: 'session_id' });
  };
  return Session;
};
