const controller = require('../controllers/newsletter.controller');
const { internalAuth } = require('../middleware');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  // ── Public ────────────────────────────────────────────────────────
  router.post('/platform/newsletter/subscribe', validate(schemas.subscribeNewsletter), controller.subscribe);
  router.get('/platform/newsletter/unsubscribe', validate(schemas.unsubscribeNewsletter), controller.unsubscribe);

  // ── Internal (admin) ─────────────────────────────────────────────
  router.get('/internal/platform/newsletter/subscribers', internalAuth, controller.listSubscribers);
  router.delete('/internal/platform/newsletter/subscribers/:id', internalAuth, validate(schemas.idParam), controller.deleteSubscriber);

  router.get('/internal/platform/newsletter/templates', internalAuth, controller.listTemplates);
  router.post('/internal/platform/newsletter/templates', internalAuth, validate(schemas.createNewsletterTemplate), controller.createTemplate);
  router.put('/internal/platform/newsletter/templates/:id', internalAuth, validate(schemas.updateNewsletterTemplate), controller.updateTemplate);
  router.delete('/internal/platform/newsletter/templates/:id', internalAuth, validate(schemas.idParam), controller.deleteTemplate);

  router.post('/internal/platform/newsletter/send', internalAuth, validate(schemas.sendNewsletter), controller.sendNewsletter);
  router.post('/internal/platform/newsletter/sync-members', internalAuth, controller.syncMembershipSubscribers);
}

module.exports = { register };
