const bcrypt = require('bcryptjs');
const { Role, User } = require('../models');
const { required } = require('../../../../shared/env');

async function seed() {
  const email = required('SEED_SUPER_ADMIN_EMAIL');
  const password = required('SEED_SUPER_ADMIN_PASSWORD');

  await Promise.all([
    Role.findOrCreate({ where: { name: 'user' }, defaults: { name: 'user' } }),
    Role.findOrCreate({ where: { name: 'admin' }, defaults: { name: 'admin' } }),
    Role.findOrCreate({ where: { name: 'super_admin' }, defaults: { name: 'super_admin' } }),
    Role.findOrCreate({ where: { name: 'editor' }, defaults: { name: 'editor' } }),
    Role.findOrCreate({ where: { name: 'viewer' }, defaults: { name: 'viewer' } }),
    Role.findOrCreate({ where: { name: 'editor_articles' }, defaults: { name: 'editor_articles' } }),
    Role.findOrCreate({ where: { name: 'custom' }, defaults: { name: 'custom' } }),
  ]);
  const superAdminRole = await Role.findOne({ where: { name: 'super_admin' } });

  const superAdmin = superAdminRole;
  const password_hash = await bcrypt.hash(password, 10);

  const [userInstance, created] = await User.scope('withPassword').findOrCreate({
    where: { email },
    defaults: {
      email,
      password_hash,
      name: 'Super Admin',
      role_id: superAdmin.id,
      is_active: true,
    },
  });

  if (!created) {
    await userInstance.update({ password_hash, role_id: superAdmin.id, is_active: true });
    console.log('Super admin user updated:', email);
  } else {
    console.log('Super admin user created:', email);
  }

  console.log('Roles: user, admin, super_admin, editor, viewer, editor_articles, custom');
  console.log('Super admin login:', email);
  process.exit(0);
}

require('../models')
  .connect()
  .then(seed)
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
