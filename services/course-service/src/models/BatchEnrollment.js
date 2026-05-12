const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const BatchEnrollment = sequelize.define(
        'BatchEnrollment',
        {
            id: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
            batch_id: { type: DataTypes.INTEGER, allowNull: false },
            user_id: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
            enrolled_at: { type: DataTypes.DATE, allowNull: true, defaultValue: DataTypes.NOW },
        },
        {
            tableName: 'batch_enrollments',
            underscored: true,
            timestamps: false,
            indexes: [
                { unique: true, fields: ['batch_id', 'user_id'] },
            ],
        }
    );
    BatchEnrollment.associate = (models) => {
        BatchEnrollment.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'Batch' });
    };
    return BatchEnrollment;
};
