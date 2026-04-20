const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Certificate = sequelize.define(
    'Certificate',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      certificate_number: { type: DataTypes.STRING(32), allowNull: false, unique: true },
      issued_at: { type: DataTypes.DATE, allowNull: false },
      pdf_url: { type: DataTypes.STRING(512), allowNull: true },
      verification_token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'certificates',
      underscored: true,
      timestamps: false,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  return Certificate;
};
