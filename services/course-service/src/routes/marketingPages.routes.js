const marketingPagesController = require('../controllers/marketingPages.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  router.get(
    '/marketing-pages/slug/:slug',
    validate(schemas.slugParam),
    marketingPagesController.getPublicBySlug,
  );
  router.get('/course-page-settings/public', marketingPagesController.getPublicPageSettings);

  router.get('/internal/marketing-pages', internalAuth, marketingPagesController.listInternal);
  router.get(
    '/internal/marketing-pages/by-slug/:slug',
    internalAuth,
    validate(schemas.slugParam),
    marketingPagesController.getBySlugInternal,
  );
  router.get(
    '/internal/marketing-pages/:id',
    internalAuth,
    validate(schemas.idParam),
    marketingPagesController.getByIdInternal,
  );
  router.post(
    '/internal/marketing-pages',
    internalAuth,
    validate(schemas.createMarketingPage),
    marketingPagesController.createInternal,
  );
  router.put(
    '/internal/marketing-pages/:id',
    internalAuth,
    validate(schemas.updateMarketingPage),
    marketingPagesController.updateInternal,
  );
  router.delete(
    '/internal/marketing-pages/:id',
    internalAuth,
    validate(schemas.idParam),
    marketingPagesController.deleteInternal,
  );
}

module.exports = { register };
