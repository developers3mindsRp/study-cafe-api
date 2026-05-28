require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
const { sequelize, User, Role } = require('../src/models');
const bcrypt = require('bcryptjs');

const EMAIL    = process.argv[2] || process.env.SEED_SUPER_ADMIN_EMAIL    || 'admin@studycafe.in';
const PASSWORD = process.argv[3] || process.env.SEED_SUPER_ADMIN_PASSWORD || 'admin123';

async function seedAdmin() {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Connected.');

        let role = await Role.findOne({ where: { name: 'super_admin' } });
        if (!role) {
            console.log('Creating super_admin role...');
            role = await Role.create({ name: 'super_admin' });
        }

        const user = await User.scope('withPassword').findOne({ where: { email: EMAIL } });
        const password_hash = await bcrypt.hash(PASSWORD, 10);

        if (user) {
            console.log(`User ${EMAIL} found. Updating to super_admin...`);
            await user.update({
                role_id: role.id,
                password_hash,
                is_active: true,
            });
            console.log('User updated.');
        } else {
            console.log(`Creating new super_admin user ${EMAIL}...`);
            await User.create({
                email: EMAIL,
                password_hash,
                name: 'Super Admin',
                role_id: role.id,
                is_active: true,
                permission_overrides: [],
            });
            console.log('User created.');
        }

        process.exit(0);
    } catch (err) {
        console.error('Failed to seed admin:', err);
        process.exit(1);
    }
}

seedAdmin();
