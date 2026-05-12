const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Batch = sequelize.define(
    'Batch',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      course_id: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: false, defaultValue: '' },
      start_date: { type: DataTypes.DATEONLY, allowNull: true },
      end_date: { type: DataTypes.DATEONLY, allowNull: true },
      meet_link: { type: DataTypes.STRING(512), allowNull: true },
    },
    {
      tableName: 'batches',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  Batch.associate = (models) => {
    Batch.belongsTo(models.Course, { foreignKey: 'course_id', as: 'Course' });
    Batch.hasMany(models.Session, { foreignKey: 'batch_id' });
  };
  return Batch;
};
