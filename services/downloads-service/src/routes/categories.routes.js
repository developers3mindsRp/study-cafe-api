const categoriesController = require('../controllers/categories.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  // Public routes
  router.get('/api/downloads/categories', categoriesController.list);
  router.get(
    '/api/downloads/categories/:slug/files',
    validate(schemas.categoryFilesQuery),
    categoriesController.listFiles
  );

  // Internal (admin) routes — server-side paginated list for admin DataTable
  router.get('/internal/downloads/categories', internalAuth, categoriesController.listAdmin);
  router.post(
    '/internal/downloads/categories',
    internalAuth,
    validate(schemas.createCategory),
    categoriesController.create
  );
  router.put(
    '/internal/downloads/categories/:id',
    internalAuth,
    validate(schemas.updateCategory),
    categoriesController.update
  );
  router.delete(
    '/internal/downloads/categories/:id',
    internalAuth,
    validate(schemas.idParam),
    categoriesController.remove
  );
}

module.exports = { register };
