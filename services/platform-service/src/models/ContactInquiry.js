const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  return sequelize.define(
    'ContactInquiry',
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      first_name: { type: DataTypes.STRING(100), allowNull: false },
      last_name: { type: DataTypes.STRING(100), allowNull: false },
      email: { type: DataTypes.STRING(255), allowNull: false },
      mobile_number: { type: DataTypes.STRING(30), allowNull: false },
      country_code: { type: DataTypes.STRING(8), allowNull: true, defaultValue: 'IN' },
      subject: { type: DataTypes.STRING(255), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'new' },
    },
    {
      tableName: 'contact_inquiries',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );
};
