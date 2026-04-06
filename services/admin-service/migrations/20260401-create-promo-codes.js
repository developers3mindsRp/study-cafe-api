module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('promo_codes', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      code: { type: Sequelize.STRING(32), allowNull: false, unique: true },
      description: { type: Sequelize.STRING(1024), allowNull: true },
      discount_type: {
        type: Sequelize.ENUM('percentage', 'fixed'),
        allowNull: false,
        defaultValue: 'percentage',
      },
      target_type: {
        type: Sequelize.ENUM('membership_plans', 'courses'),
        allowNull: false,
        defaultValue: 'membership_plans',
      },
      discount_value: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      max_discount_amount: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      min_cart_value: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      valid_from: { type: Sequelize.DATE, allowNull: false },
      valid_to: { type: Sequelize.DATE, allowNull: false },
      usage_limit: { type: Sequelize.INTEGER, allowNull: true },
      used_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
        onUpdate: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
  },

  down: async (queryInterface) => {
    await queryInterface.dropTable('promo_codes');
  },
};
