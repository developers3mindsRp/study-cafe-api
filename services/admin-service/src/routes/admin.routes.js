const controller = require('../controllers/admin.controller');
const { requireAdmin, internalAuth } = require('../middleware');
const { uploadImage: uploadImageMw, uploadFile: uploadFileMw } = require('../middleware/upload');

function register(router) {
  router.get('/admin/me', requireAdmin, controller.me);
  router.get('/internal/payment-config', internalAuth, controller.getPaymentConfigInternal);
  router.get('/platform/payment-links', controller.listPaymentLinksPublic);
  router.get('/platform/payment-links/:slug', controller.getPaymentLinkPublicBySlug);
  router.get('/internal/payment-links/:id', internalAuth, controller.getPaymentLinkInternal);
  router.get('/admin/stats', requireAdmin, controller.getStats);
  router.put('/admin/payment-config', requireAdmin, controller.updatePaymentConfig);
  router.get('/admin/logs', requireAdmin, controller.getLogs);

  router.get('/admin/courses', requireAdmin, controller.getCourses);
  router.get('/admin/courses/:id', requireAdmin, controller.getCourse);
  router.get('/admin/courses/:id/sessions', requireAdmin, controller.getCourseSessions);
  router.get('/admin/batches', requireAdmin, controller.listBatches);
  router.get('/admin/course-cats', requireAdmin, controller.getCourseCats);
  router.post('/admin/course-cats', requireAdmin, controller.createCourseCat);
  router.put('/admin/course-cats/:id', requireAdmin, controller.updateCourseCat);
  router.delete('/admin/course-cats/:id', requireAdmin, controller.deleteCourseCat);
  router.get('/admin/orders', requireAdmin, controller.getOrders);
  router.get('/admin/orders/:orderId', requireAdmin, controller.getOrderByOrderId);
  router.post('/admin/orders', requireAdmin, controller.createOrder);
  router.post('/admin/orders/apply-coupon', requireAdmin, controller.applyCouponAdmin);
  router.put('/admin/orders/:id', requireAdmin, controller.updateOrder);
  router.post('/admin/orders/:id/refund', requireAdmin, controller.refundOrder);
  router.delete('/admin/orders/:id', requireAdmin, controller.deleteOrder);

  // Coupon management
  router.get('/admin/coupons', requireAdmin, controller.getCoupons);
  router.get('/admin/coupons/check-code', requireAdmin, controller.checkCouponCodeExists);
  router.get('/admin/coupons/:id', requireAdmin, controller.getCoupon);
  router.post('/admin/coupons', requireAdmin, controller.postCoupon);
  router.put('/admin/coupons/:id', requireAdmin, controller.putCoupon);
  router.delete('/admin/coupons/:id', requireAdmin, controller.deleteCoupon);
  router.get('/admin/payment-links', requireAdmin, controller.listPaymentLinksAdmin);
  router.get('/admin/payment-links/:id', requireAdmin, controller.getPaymentLinkAdmin);
  router.post('/admin/payment-links', requireAdmin, controller.postPaymentLink);
  router.put('/admin/payment-links/:id', requireAdmin, controller.putPaymentLink);
  router.delete('/admin/payment-links/:id', requireAdmin, controller.deletePaymentLink);
  router.post('/admin/courses', requireAdmin, controller.createCourse);
  router.put('/admin/courses/:id', requireAdmin, controller.updateCourse);
  router.post('/admin/courses/:id/batches', requireAdmin, controller.createBatch);
  router.put('/admin/batches/:id', requireAdmin, controller.updateBatch);
  router.post('/admin/batches/:id/sync', requireAdmin, controller.syncBatch);
  router.post('/admin/batches/:id/sessions', requireAdmin, controller.createSession);
  router.put('/admin/sessions/:id', requireAdmin, controller.updateSession);
  router.post('/admin/sessions/:id/recordings', requireAdmin, controller.addRecording);
  router.put('/admin/recordings/:id', requireAdmin, controller.updateRecording);
  router.put('/admin/recordings/:id/visibility', requireAdmin, controller.toggleRecordingVisibility);
  router.delete('/admin/recordings/:id', requireAdmin, controller.deleteRecording);
  router.delete('/admin/sessions/:id', requireAdmin, controller.deleteSession);
  router.delete('/admin/batches/:id', requireAdmin, controller.deleteBatch);
  router.get('/admin/batches/:id/enrollments', requireAdmin, controller.getBatchEnrollments);
  router.post('/admin/batches/:id/enrollments', requireAdmin, controller.addBatchEnrollment);
  router.post('/admin/batches/:id/enrollments/bulk', requireAdmin, controller.bulkAddBatchEnrollmentByEmails);
  router.post('/admin/memberships/bulk', requireAdmin, controller.bulkGrantMembershipByEmails);
  router.post('/admin/users/import', requireAdmin, controller.importUsersFromCsv);
  router.delete('/admin/batch-enrollments/:id', requireAdmin, controller.removeBatchEnrollment);
  router.get('/admin/users/:id/enrollments', requireAdmin, controller.getUserEnrollments);
  router.get('/admin/users/:id/memberships', requireAdmin, controller.getUserMemberships);
  router.post('/admin/courses/:id/materials', requireAdmin, controller.addMaterial);
  router.get('/admin/course-reviews', requireAdmin, controller.getCourseReviews);
  router.get('/admin/course-reviews/:id', requireAdmin, controller.getCourseReviewById);
  router.patch('/admin/course-reviews/:id', requireAdmin, controller.patchCourseReview);
  router.delete('/admin/course-reviews/:id', requireAdmin, controller.deleteCourseReview);
  router.get('/admin/course-page-settings', requireAdmin, controller.getCoursePageSettings);
  router.put('/admin/course-page-settings/:key', requireAdmin, controller.updateCoursePageSetting);

  const p = controller.platform;
  router.get('/admin/platform/home', requireAdmin, p.getHome);
  router.put('/admin/platform/home', requireAdmin, p.putHome);
  router.get('/admin/platform/states', requireAdmin, p.getStates);
  router.post('/admin/platform/states', requireAdmin, p.postState);
  router.put('/admin/platform/states/:id', requireAdmin, p.putState);
  router.get('/admin/platform/testimonials', requireAdmin, p.getTestimonials);
  router.post('/admin/platform/testimonials', requireAdmin, p.postTestimonial);
  router.put('/admin/platform/testimonials/:id', requireAdmin, p.putTestimonial);
  router.delete('/admin/platform/testimonials/:id', requireAdmin, p.deleteTestimonial);
  router.get('/admin/platform/faqs', requireAdmin, p.getFaqs);
  router.get('/admin/platform/faqs/:id', requireAdmin, p.getFaq);
  router.post('/admin/platform/faqs', requireAdmin, p.postFaq);
  router.put('/admin/platform/faqs/:id', requireAdmin, p.putFaq);
  router.delete('/admin/platform/faqs/:id', requireAdmin, p.deleteFaq);
  router.get('/admin/platform/seo-metadata', requireAdmin, p.getSeoMetadata);
  router.get('/admin/platform/seo-metadata/eligible-pages', requireAdmin, p.getSeoEligiblePages);
  router.get('/admin/platform/seo-metadata/:id', requireAdmin, p.getSeoMetadataById);
  router.get('/admin/platform/seo-metadata/slug/:slug', requireAdmin, p.getSeoMetadataBySlug);
  router.post('/admin/platform/seo-metadata', requireAdmin, p.postSeoMetadata);
  router.put('/admin/platform/seo-metadata/:id', requireAdmin, p.putSeoMetadata);
  router.delete('/admin/platform/seo-metadata/:id', requireAdmin, p.deleteSeoMetadata);
  router.get('/admin/platform/site-seo-routes', requireAdmin, p.listSiteSeoRoutes);
  router.post('/admin/platform/site-seo-routes', requireAdmin, p.postSiteSeoRoute);
  router.put('/admin/platform/site-seo-routes/:id', requireAdmin, p.putSiteSeoRoute);
  router.delete('/admin/platform/site-seo-routes/:id', requireAdmin, p.deleteSiteSeoRoute);
  router.get('/admin/platform/footer', requireAdmin, p.getFooter);
  router.put('/admin/platform/footer/:key', requireAdmin, p.putFooter);
  router.get('/admin/platform/site-ads', requireAdmin, p.getSiteAds);
  router.put('/admin/platform/site-ads', requireAdmin, p.putSiteAds);
  router.get('/admin/platform/global-settings', requireAdmin, p.getGlobalSettings);
  router.put('/admin/platform/global-settings/:key', requireAdmin, p.putGlobalSetting);
  router.get('/admin/platform/plans', requireAdmin, p.getPlans);
  router.get('/admin/platform/plans/:id', requireAdmin, p.getPlan);
  router.post('/admin/platform/plans', requireAdmin, p.postPlan);
  router.put('/admin/platform/plans/:id', requireAdmin, p.putPlan);
  router.put('/admin/platform/plans/:id/popular', requireAdmin, p.togglePlanPopular);
  router.delete('/admin/platform/plans/:id', requireAdmin, p.deletePlan);
  router.get('/admin/platform/comparison-features', requireAdmin, p.getComparisonFeatures);
  router.post('/admin/platform/comparison-features', requireAdmin, p.postComparisonFeature);
  router.put('/admin/platform/comparison-features/:id', requireAdmin, p.putComparisonFeature);
  router.delete('/admin/platform/comparison-features/:id', requireAdmin, p.deleteComparisonFeature);
  router.put('/admin/platform/comparison-features/:featureId/availability/:planId', requireAdmin, p.setFeatureAvailability);
  router.get('/admin/platform/coupons', requireAdmin, p.getCoupons);
  router.get('/admin/platform/coupons/check-code', requireAdmin, p.checkCouponCodeExists);
  router.get('/admin/platform/coupons/:id', requireAdmin, p.getCoupon);
  router.post('/admin/platform/coupons', requireAdmin, p.postCoupon);
  router.put('/admin/platform/coupons/:id', requireAdmin, p.putCoupon);
  router.delete('/admin/platform/coupons/:id', requireAdmin, p.deleteCoupon);
  router.get('/admin/platform/articles', requireAdmin, p.getArticles);
  router.get('/admin/platform/articles/:id', requireAdmin, p.getArticle);
  router.post('/admin/platform/articles', requireAdmin, p.postArticle);
  router.put('/admin/platform/articles/:id', requireAdmin, p.putArticle);
  router.delete('/admin/platform/articles/:id', requireAdmin, p.deleteArticle);
  router.get('/admin/platform/article-categories', requireAdmin, p.getArticleCategories);
  router.get('/admin/platform/article-categories/:id', requireAdmin, p.getArticleCategory);
  router.post('/admin/platform/article-categories', requireAdmin, p.createArticleCategory);
  router.put('/admin/platform/article-categories/:id', requireAdmin, p.updateArticleCategory);
  router.delete('/admin/platform/article-categories/:id', requireAdmin, p.deleteArticleCategory);
  router.get('/admin/platform/tags', requireAdmin, p.getTags);
  router.get('/admin/platform/article-types', requireAdmin, p.getArticleTypes);
  router.get('/admin/platform/courts', requireAdmin, p.getCourts);
  router.get('/admin/platform/cms-pages', requireAdmin, p.getCmsPages);
  router.get('/admin/platform/cms-pages/:slug', requireAdmin, p.getCmsPageBySlug);
  router.put('/admin/platform/cms-pages/:slug', requireAdmin, p.putCmsPage);
  router.post('/admin/upload', requireAdmin, uploadImageMw, controller.uploadImage);
  router.post('/admin/upload-file', requireAdmin, uploadFileMw, controller.uploadFile);

  // ── Media assets (icons library) ────────────────────────────────────
  router.get('/admin/platform/contact-inquiries', requireAdmin, p.contactInquiries);
  router.get('/admin/platform/media-assets', requireAdmin, p.getMediaAssets);
  router.post('/admin/platform/media-assets', requireAdmin, p.postMediaAsset);
  router.delete('/admin/platform/media-assets/:id', requireAdmin, p.deleteMediaAsset);

  // ── Newsletter ──────────────────────────────────────────────────────
  router.get('/admin/platform/newsletter/subscribers', requireAdmin, p.getNewsletterSubscribers);
  router.delete('/admin/platform/newsletter/subscribers/:id', requireAdmin, p.deleteNewsletterSubscriber);
  router.get('/admin/platform/newsletter/templates', requireAdmin, p.getNewsletterTemplates);
  router.post('/admin/platform/newsletter/templates', requireAdmin, p.postNewsletterTemplate);
  router.put('/admin/platform/newsletter/templates/:id', requireAdmin, p.putNewsletterTemplate);
  router.delete('/admin/platform/newsletter/templates/:id', requireAdmin, p.deleteNewsletterTemplate);
  router.post('/admin/platform/newsletter/send', requireAdmin, p.sendNewsletter);
  router.post('/admin/platform/newsletter/sync-members', requireAdmin, p.syncMembershipSubscribers);

  // ── Banners ─────────────────────────────────────────────────────────
  router.get('/admin/platform/banners', requireAdmin, p.getBanners);
  router.get('/admin/platform/banners/:id', requireAdmin, p.getBanner);
  router.post('/admin/platform/banners', requireAdmin, p.postBanner);
  router.put('/admin/platform/banners/:id', requireAdmin, p.putBanner);
  router.delete('/admin/platform/banners/:id', requireAdmin, p.deleteBanner);


  // ── Affiliate routes ───────────────────────────────────────────────
  router.get('/admin/affiliate/history', requireAdmin, controller.getAffiliateHistory);
  router.get('/admin/affiliate/withdrawals', requireAdmin, controller.getWithdrawalRequests);
  router.get('/admin/affiliate/balance/:userId', requireAdmin, controller.getAffiliateBalance);
  router.post('/admin/affiliate/withdrawals', requireAdmin, controller.createWithdrawalRequest);
  router.patch('/admin/affiliate/withdrawals/:id', requireAdmin, controller.updateWithdrawalStatus);
}

module.exports = { register };
