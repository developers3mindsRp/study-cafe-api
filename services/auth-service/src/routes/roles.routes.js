const rolesController = require('../controllers/roles.controller');
const adminUsersController = require('../controllers/adminUsers.controller');
const { requireAdmin, requirePermission } = require('../middleware/requireAdmin');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.get(
    '/auth/admin/permissions/catalog',
    requireAdmin,
    requirePermission('roles:view', 'roles:list', 'admin_users:view', 'admin_users:edit'),
    rolesController.catalog
  );

  router.get(
    '/auth/admin/roles',
    requireAdmin,
    requirePermission('roles:list', 'roles:view', 'admin_users:list', 'admin_users:view', 'admin_users:create', 'admin_users:edit'),
    rolesController.list
  );

  router.get(
    '/auth/admin/roles/:id',
    requireAdmin,
    requirePermission('roles:view', 'roles:edit', 'admin_users:view', 'admin_users:edit'),
    validate(schemas.idParam),
    rolesController.getOne
  );

  router.post(
    '/auth/admin/roles',
    requireAdmin,
    requirePermission('roles:create', 'admin_users:edit'),
    validate(schemas.createRole),
    rolesController.create
  );

  router.patch(
    '/auth/admin/roles/:id',
    requireAdmin,
    requirePermission('roles:edit', 'admin_users:edit'),
    validate(schemas.updateRole),
    rolesController.update
  );

  router.delete(
    '/auth/admin/roles/:id',
    requireAdmin,
    requirePermission('roles:delete', 'admin_users:edit'),
    validate(schemas.idParam),
    rolesController.remove
  );

  // Legacy alias — create role name only (prefer POST /auth/admin/roles)
  router.post(
    '/auth/admin/role',
    requireAdmin,
    requirePermission('roles:create', 'admin_users:list', 'admin_users:view', 'admin_users:create', 'admin_users:edit'),
    adminUsersController.createRole
  );
}

module.exports = { register };
