const filesController = require('../controllers/files.controller');
const { internalAuth, requireActiveMembership } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  // Public routes (file_url is intentionally NOT included in these responses)
  router.get('/api/downloads/files', validate(schemas.listFilesQuery), filesController.list);

  // Member-only: returns the actual download URL. Must be registered BEFORE
  // /:idOrSlug so Express doesn't match `/:idOrSlug` first when the path is
  // `/.../url`. Only authenticated users with an active membership get past
  // requireActiveMembership.
  // Prefer this path in clients: some reverse proxies mishandle ".../files/:slug/url".
  router.get(
    '/api/downloads/download-url/:idOrSlug',
    validate(schemas.idOrSlugParam),
    requireActiveMembership,
    filesController.getDownloadUrl
  );

  // Legacy / alternate (keep for older clients)
  router.get(
    '/api/downloads/files/:idOrSlug/url',
    validate(schemas.idOrSlugParam),
    requireActiveMembership,
    filesController.getDownloadUrl
  );

  router.get('/api/downloads/files/:idOrSlug', validate(schemas.idOrSlugParam), filesController.getOne);

  /** Client-only view counter (avoids double-count from SSR + hydration). */
  router.post(
    '/api/downloads/files/:idOrSlug/view',
    validate(schemas.idOrSlugParam),
    filesController.recordView
  );

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
