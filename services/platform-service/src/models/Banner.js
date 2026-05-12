const { DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  const Banner = sequelize.define(
    "Banner",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      identifier: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      desktop_image_url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      mobile_image_url: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      link_url: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "banners",
      underscored: true,
      timestamps: true,
    }
  );

  return Banner;
};
