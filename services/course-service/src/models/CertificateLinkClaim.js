const { DataTypes } = require('sequelize');

/**
 * One lead row per (link, email). Carries a denormalized `serial`, `course_id` and the raw
 * as-typed contact details so the admin claims list renders without a join.
 *
 * `name` here is what that submission typed; the name actually printed on the certificate is
 * frozen at first claim in public_certificates.name.
 */
module.exports = (sequelize) => {
  const CertificateLinkClaim = sequelize.define(
    'CertificateLinkClaim',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      link_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      public_certificate_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      serial: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      name: { type: DataTypes.STRING(190), allowNull: false },
      email: { type: DataTypes.STRING(190), allowNull: false },
      email_norm: { type: DataTypes.STRING(190), allowNull: false },
      phone: { type: DataTypes.STRING(32), allowNull: true },
      phone_norm: { type: DataTypes.STRING(32), allowNull: true },
      ip: { type: DataTypes.STRING(45), allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
      utm_source: { type: DataTypes.STRING(190), allowNull: true },
      utm_medium: { type: DataTypes.STRING(190), allowNull: true },
      utm_campaign: { type: DataTypes.STRING(190), allowNull: true },
      download_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
      last_claimed_at: { type: DataTypes.DATE, allowNull: false },
    },
    {
      tableName: 'certificate_link_claims',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  );

  CertificateLinkClaim.associate = (models) => {
    CertificateLinkClaim.belongsTo(models.CertificateLink, { foreignKey: 'link_id', as: 'Link' });
  };

  return CertificateLinkClaim;
};
