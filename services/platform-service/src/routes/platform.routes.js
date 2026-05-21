const controller = require('../controllers/platform.controller');
const { internalAuth } = require('../middleware');
const { optionalWebUser } = require('../middleware/optionalWebUser');
const { uploadImage: uploadImageMw, uploadFile: uploadFileMw } = require('../middleware/upload');
const schemas = require('../validations/schemas');
const { validate } = require('../../../../shared');

function register(router) {
  // ── Public routes ────────────────────────────────────────────────
  router.get('/platform/home', controller.getHome);
  router.get('/platform/states', controller.getStates);
  router.get('/platform/testimonials', controller.getTestimonials);
  router.get('/platform/faq', controller.getFaqs);
  router.get('/plateform/contact-inquiries', controller.getContactInquiryInternal)
  router.get('/platform/footer', controller.getFooter);
  router.get('/platform/global-settings/snippets', controller.getGlobalSettingsSnippetsPublic);
  router.get('/platform/site-ads', controller.getSiteAds);
  /** Same payload as site-ads — neutral path so browser extensions are less likely to block the request. */
  router.get('/platform/cms-display-placements', controller.getSiteAds);
  router.get('/platform/plans', controller.getPlans);
  router.get('/platform/plans/:slug', validate(schemas.slugParam), controller.getPlanBySlug);
  router.get('/platform/memberships', controller.getPlans);
  router.post('/platform/membership/upgrade-summary', controller.getMembershipUpgradeSummary);
  router.get('/platform/articles', controller.getArticles);
  router.get('/platform/articles/blog-spotlight', optionalWebUser, controller.getBlogSpotlightFeed);
  router.get(
    '/platform/articles/:slug/up-next',
    optionalWebUser,
    validate(schemas.slugParam),
    controller.getArticleUpNext,
  );
  router.get('/platform/articles/:slug', optionalWebUser, validate(schemas.slugParam), controller.getArticleBySlug);
  router.get('/platform/article-categories', controller.getArticleCategories);
  router.get(
    '/platform/seo-metadata/by-path',
    validate(schemas.seoByPathQuery),
    controller.getSeoMetadataByPathPublic,
  );
  router.get('/platform/seo-metadata/slug/:slug', validate(schemas.slugParam), controller.getSeoMetadataBySlugPublic);
  router.get('/platform/cms-pages/:slug', validate(schemas.slugParam), controller.getCmsPageBySlug);
  router.post('/platform/contact-us', validate(schemas.createContactInquiry), controller.createContactInquiry);
  router.get('/platform/banners', controller.getBanners);
  router.get('/platform/banners/:identifier', controller.getBannerByIdentifier);

  // ── Internal routes (admin proxy) ────────────────────────────────
  router.get('/internal/platform/home', internalAuth, controller.getHomeInternal);
  router.put('/internal/platform/home', internalAuth, controller.putHomePage);
  router.get('/internal/platform/states', internalAuth, controller.getStatesInternal);
  router.post('/internal/platform/states', internalAuth, validate(schemas.createState), controller.createState);
  router.put('/internal/platform/states/:id', internalAuth, validate(schemas.updateState), controller.updateState);
  router.get('/internal/platform/testimonials', internalAuth, controller.getTestimonialsInternal);
  router.post('/internal/platform/testimonials', internalAuth, validate(schemas.createTestimonial), controller.createTestimonial);
  router.put('/internal/platform/testimonials/:id', internalAuth, validate(schemas.updateTestimonial), controller.updateTestimonial);
  router.delete('/internal/platform/testimonials/:id', internalAuth, validate(schemas.idParam), controller.deleteTestimonial);
  router.get('/internal/platform/faqs', internalAuth, controller.getFaqsInternal);
  router.get('/internal/platform/faqs/:id', internalAuth, validate(schemas.idParam), controller.getFaqInternal);
  router.post('/internal/platform/faqs', internalAuth, validate(schemas.createFaq), controller.createFaq);
  router.put('/internal/platform/faqs/:id', internalAuth, validate(schemas.updateFaq), controller.updateFaq);
  router.delete('/internal/platform/faqs/:id', internalAuth, validate(schemas.idParam), controller.deleteFaq);
  router.get('/internal/platform/seo-metadata', internalAuth, controller.getSeoMetadataInternal);
  router.get('/internal/platform/seo-metadata/eligible-pages', internalAuth, controller.getSeoEligiblePagesInternal);
  router.post(
    '/internal/platform/seo-metadata/sync-module',
    internalAuth,
    validate(schemas.syncModuleSeoMetadata),
    controller.syncModuleSeoMetadata
  );
  router.get('/internal/platform/seo-metadata/:id', internalAuth, validate(schemas.idParam), controller.getSeoMetadataByIdInternal);
  router.get('/internal/platform/seo-metadata/slug/:slug', internalAuth, validate(schemas.slugParam), controller.getSeoMetadataBySlugPublic);
  router.post('/internal/platform/seo-metadata', internalAuth, validate(schemas.createSeoMetadata), controller.createSeoMetadata);
  router.put('/internal/platform/seo-metadata/:id', internalAuth, validate(schemas.updateSeoMetadata), controller.updateSeoMetadata);
  router.delete('/internal/platform/seo-metadata/:id', internalAuth, validate(schemas.idParam), controller.deleteSeoMetadata);
  router.get('/internal/platform/site-seo-routes', internalAuth, controller.listSiteSeoRoutesInternal);
  router.post(
    '/internal/platform/site-seo-routes',
    internalAuth,
    validate(schemas.createSiteSeoRoute),
    controller.createSiteSeoRoute
  );
  router.put(
    '/internal/platform/site-seo-routes/:id',
    internalAuth,
    validate(schemas.updateSiteSeoRoute),
    controller.updateSiteSeoRoute
  );
  router.delete(
    '/internal/platform/site-seo-routes/:id',
    internalAuth,
    validate(schemas.idParam),
    controller.deleteSiteSeoRoute
  );
  router.get('/internal/platform/footer', internalAuth, controller.getFooterInternal);
  router.put('/internal/platform/footer/:key', internalAuth, validate(schemas.upsertFooter), controller.upsertFooter);
  router.get('/internal/platform/global-settings', internalAuth, controller.getGlobalSettingsInternal);
  router.put('/internal/platform/global-settings/:key', internalAuth, validate(schemas.upsertGlobalSetting), controller.putGlobalSetting);
  router.get('/internal/platform/site-ads', internalAuth, controller.getSiteAds);
  router.put('/internal/platform/site-ads', internalAuth, validate(schemas.putSiteAds), controller.putSiteAds);
  router.get('/internal/platform/plans', internalAuth, controller.getPlansInternal);
  router.get('/internal/platform/plans/:id', internalAuth, validate(schemas.idParam), controller.getPlanByIdInternal);
  router.post('/internal/platform/plans', internalAuth, validate(schemas.createPlan), controller.createPlan);
  router.put('/internal/platform/plans/:id', internalAuth, validate(schemas.updatePlan), controller.updatePlan);
  router.put('/internal/platform/plans/:id/popular', internalAuth, validate(schemas.idParam), controller.togglePlanPopular);
  router.delete('/internal/platform/plans/:id', internalAuth, validate(schemas.idParam), controller.deletePlan);
  router.get('/internal/platform/plans/:id/linked-courses', internalAuth, validate(schemas.idParam), controller.getPlanLinkedCoursesInternal);
  router.get('/internal/platform/plans/list-by-ids', internalAuth, controller.listPlansByIdsInternal);
  router.get('/internal/platform/contact-inquiries', internalAuth, controller.getContactInquiryInternal);

  // ── Comparison Features ──────────────────────────────────────────
  router.get('/internal/platform/comparison-features', internalAuth, controller.getComparisonFeatures);
  router.post('/internal/platform/comparison-features', internalAuth, controller.createComparisonFeature);
  router.put('/internal/platform/comparison-features/:id', internalAuth, validate(schemas.idParam), controller.updateComparisonFeature);
  router.delete('/internal/platform/comparison-features/:id', internalAuth, validate(schemas.idParam), controller.deleteComparisonFeature);
  router.put('/internal/platform/comparison-features/:featureId/availability/:planId', internalAuth, controller.setFeatureAvailability);

  router.get('/internal/platform/articles', internalAuth, validate(schemas.articleListQuery), controller.getArticlesInternal);
  router.post('/internal/platform/articles/:id/preview-token', internalAuth, validate(schemas.idParam), controller.createArticlePreviewToken);
  router.get('/internal/platform/articles/:id', internalAuth, validate(schemas.idParam), controller.getArticleByIdInternal);
  router.post('/internal/platform/articles', internalAuth, validate(schemas.createArticle), controller.createArticle);
  router.put('/internal/platform/articles/:id', internalAuth, validate(schemas.updateArticle), controller.updateArticle);
  router.delete('/internal/platform/articles/:id', internalAuth, validate(schemas.idParam), controller.deleteArticle);
  router.get('/internal/platform/article-categories', internalAuth, controller.getArticleCategoriesInternal);
  router.get('/internal/platform/article-categories/:id', internalAuth, validate(schemas.idParam), controller.getArticleCategoryByIdInternal);
  router.post('/internal/platform/article-categories', internalAuth, validate(schemas.createArticleCategory), controller.createArticleCategory);
  router.put('/internal/platform/article-categories/:id', internalAuth, validate(schemas.updateArticleCategory), controller.updateArticleCategory);
  router.delete('/internal/platform/article-categories/:id', internalAuth, validate(schemas.idParam), controller.deleteArticleCategory);
  router.get('/internal/platform/tags', internalAuth, controller.getTagsInternal);
  router.get('/internal/platform/article-types', internalAuth, controller.getArticleTypesInternal);
  router.get('/internal/platform/courts', internalAuth, controller.getCourtsInternal);
  router.get('/internal/platform/cms-pages', internalAuth, controller.getCmsPagesInternal);
  router.get('/internal/platform/cms-pages/:slug', internalAuth, validate(schemas.slugParam), controller.getCmsPageBySlugInternal);
  router.put('/internal/platform/cms-pages/:slug', internalAuth, validate(schemas.upsertCmsPage), controller.putCmsPageBySlug);
  router.post('/internal/platform/upload/image', internalAuth, uploadImageMw, controller.uploadImage);
  router.post('/internal/platform/upload/file', internalAuth, uploadFileMw, controller.uploadFile);

  // ── Media assets (icons library) ────────────────────────────────────
  router.get('/internal/platform/media-assets', internalAuth, controller.getMediaAssets);
  router.post('/internal/platform/media-assets', internalAuth, controller.createMediaAsset);
  router.delete('/internal/platform/media-assets/:id', internalAuth, controller.deleteMediaAsset);

  // ── Banners ─────────────────────────────────────────────────────────
  router.get('/internal/platform/banners', internalAuth, controller.getBannersInternal);
  router.get('/internal/platform/banners/:id', internalAuth, validate(schemas.idParam), controller.getBannerInternal);
  router.post('/internal/platform/banners', internalAuth, validate(schemas.createBanner), controller.createBanner);
  router.put('/internal/platform/banners/:id', internalAuth, validate(schemas.updateBanner), controller.updateBanner);
  router.delete('/internal/platform/banners/:id', internalAuth, validate(schemas.idParam), controller.deleteBanner);
}

module.exports = { register };
