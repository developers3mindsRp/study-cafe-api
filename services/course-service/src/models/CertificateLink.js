const { DataTypes } = require('sequelize');

/**
 * Admin-created shareable link that lets anyone (no login, no purchase) claim a certificate for a
 * course. Used by the admin CRUD reads so `paginate()` works directly; the claim write path stays
 * raw SQL in publicCertificateLink.service.js for its lock semantics.
 */
module.exports = (sequelize) => {
  const CertificateLink = sequelize.define(
    'CertificateLink',
    {
      id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
      /** Bearer secret in the public URL. Never log it in full. */
      token: { type: DataTypes.STRING(64), allowNull: false },
      course_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      title: { type: DataTypes.STRING(255), allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.ENUM('draft', 'active', 'disabled'),
        allowNull: false,
        defaultValue: 'draft',
      },
      /** Required. Expiry is computed from this on every read — there is no cron job. */
      expires_at: { type: DataTypes.DATE, allowNull: false },
      /** Fixed date printed on the certificate (the event/webinar date). Null → claim date. */
      certificate_date: { type: DataTypes.DATEONLY, allowNull: true },
      max_claims: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      claims_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      send_email: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: 'certificate_links',
      underscored: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      paranoid: true,
      deletedAt: 'deleted_at',
    },
  );

  CertificateLink.associate = (models) => {
    CertificateLink.belongsTo(models.Course, { foreignKey: 'course_id', as: 'Course' });
  };

  return CertificateLink;
};
