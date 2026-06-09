const adminUsersController = require('../controllers/adminUsers.controller');
const { requireAdmin, requirePermission } = require('../middleware/requireAdmin');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.get('/auth/admin/users', requireAdmin, requirePermission('admin_users:list'), adminUsersController.list);
  router.get(
    '/auth/admin/users/lookup',
    requireAdmin,
    requirePermission('admin_users:create', 'admin_users:edit'),
    validate(schemas.lookupAdminUser),
    adminUsersController.lookup
  );
  router.get('/auth/admin/users/:id', requireAdmin, requirePermission('admin_users:view', 'admin_users:edit'), validate(schemas.idParam), adminUsersController.getOne);
  router.post('/auth/admin/users', requireAdmin, requirePermission('admin_users:create'), validate(schemas.createAdminUser), adminUsersController.create);
  router.patch('/auth/admin/users/:id', requireAdmin, requirePermission('admin_users:edit'), validate(schemas.updateAdminUser), adminUsersController.update);
  router.delete('/auth/admin/users/:id', requireAdmin, requirePermission('admin_users:delete'), validate(schemas.idParam), adminUsersController.remove);
}

module.exports = { register };
