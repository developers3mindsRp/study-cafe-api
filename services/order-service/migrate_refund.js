const { sequelize } = require('./src/models');
const { DataTypes } = require('sequelize');

async function migrate() {
  const queryInterface = sequelize.getQueryInterface();
  try {
    const table = await queryInterface.describeTable('orders');
    
    if (!table.refund_amount) {
      console.log('Adding refund_amount column...');
      await queryInterface.addColumn('orders', 'refund_amount', {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      });
    }

    if (!table.refund_remarks) {
      console.log('Adding refund_remarks column...');
      await queryInterface.addColumn('orders', 'refund_remarks', {
        type: DataTypes.TEXT,
        allowNull: true,
      });
    }

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
