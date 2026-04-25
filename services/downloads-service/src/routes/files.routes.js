const filesController = require('../controllers/files.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  // Public routes
  router.get('/api/downloads/files', validate(schemas.listFilesQuery), filesController.list);
  router.get('/api/downloads/files/:idOrSlug', filesController.getOne);

  // Internal (admin) routes — server-side paginated list for admin DataTable
  router.get('/internal/downloads/files', internalAuth, filesController.listAdmin);
  router.post(
    '/internal/downloads/files',
    internalAuth,
    validate(schemas.createFile),
    filesController.create
  );
  router.put(
    '/internal/downloads/files/:id',
    internalAuth,
    validate(schemas.updateFile),
    filesController.update
  );
  router.delete(
    '/internal/downloads/files/:id',
    internalAuth,
    validate(schemas.idParam),
    filesController.remove
  );
}

module.exports = { register };
