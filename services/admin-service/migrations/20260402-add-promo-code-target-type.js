module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('promo_codes', 'target_type', {
      type: Sequelize.ENUM('membership_plans', 'courses'),
      allowNull: false,
      defaultValue: 'membership_plans',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('promo_codes', 'target_type');
  },
};
