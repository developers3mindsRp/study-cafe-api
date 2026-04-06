module.exports = {
  up: async (queryInterface) => {
    await queryInterface.bulkInsert(
      'promo_codes',
      [
        {
          code: 'WELCOME10',
          description: 'Demo promo code for initial seeding',
          discount_type: 'percentage',
          target_type: 'membership_plans',
          discount_value: 10.0,
          max_discount_amount: 100.0,
          min_cart_value: 500.0,
          active: true,
          valid_from: new Date(),
          valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          usage_limit: 100,
          used_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          code: 'WELCOME20',
          description: 'Demo promo code for initial seeding',
          discount_type: 'percentage',
          target_type: 'courses',
          discount_value: 20.0,
          max_discount_amount: 200.0,
          min_cart_value: 1000.0,
          active: true,
          valid_from: new Date(),
          valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          usage_limit: 100,
          used_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          code: 'WELCOME30',
          description: 'Demo promo code for initial seeding',
          discount_type: 'percentage',
          target_type: 'membership_plans',
          discount_value: 30.0,
          max_discount_amount: 300.0,
          min_cart_value: 1500.0,
          active: true,
          valid_from: new Date(),
          valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          usage_limit: 100,
          used_count: 0,
          created_at: new Date(),
          updated_at: new Date(),
        },
      ],
      {}
    );
  },

  down: async (queryInterface) => {
    await queryInterface.bulkDelete('promo_codes', { code: 'WELCOME10' }, {});
  },
};
