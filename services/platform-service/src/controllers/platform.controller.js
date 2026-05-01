const platformService = require('../services/platform.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent, sendPaginated, logger } = require('../../../../shared');
const { uploadsDir } = require('../middleware/upload');
const { relativePathFromFile, publicMediaUrl } = require('../../../../shared/mediaUrl');

// ── Home ───────────────────────────────────────────────────────────

const getHome = asyncHandler(async (req, res) => {
  const data = await platformService.home.getHomePublic();
  sendSuccess(res, data);
});

const getHomeInternal = asyncHandler(async (req, res) => {
  const data = await platformService.home.getHomePageInternal();
  sendSuccess(res, data);
});

const putHomePage = asyncHandler(async (req, res) => {
  const data = await platformService.home.upsertHomePage(req.body);
  sendSuccess(res, data);
});

// ── States ─────────────────────────────────────────────────────────

const getStates = asyncHandler(async (req, res) => {
  const data = await platformService.states.getStatesPublic();
  sendSuccess(res, data);
});

const getStatesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.states.getStatesInternal();
  sendSuccess(res, data);
});

const createState = asyncHandler(async (req, res) => {
  const data = await platformService.states.createState(req.body);
  sendCreated(res, data);
});

const updateState = asyncHandler(async (req, res) => {
  const data = await platformService.states.updateState(req.params.id, req.body);
  if (!data) throw new AppError('State not found', 404);
  sendSuccess(res, data);
});

// ── Testimonials ───────────────────────────────────────────────────

const getTestimonials = asyncHandler(async (req, res) => {
  const featured = req.query.featured === '1' || req.query.featured === 'true';
  const data = await platformService.testimonials.getTestimonialsPublic(featured);
  sendSuccess(res, data);
});

const getTestimonialsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.testimonials.getTestimonialsInternal();
  sendSuccess(res, data);
});

const createTestimonial = asyncHandler(async (req, res) => {
  const data = await platformService.testimonials.createTestimonial(req.body);
  sendCreated(res, data);
});

const updateTestimonial = asyncHandler(async (req, res) => {
  const data = await platformService.testimonials.updateTestimonial(req.params.id, req.body);
  if (!data) throw new AppError('Testimonial not found', 404);
  sendSuccess(res, data);
});

const deleteTestimonial = asyncHandler(async (req, res) => {
  const ok = await platformService.testimonials.deleteTestimonial(req.params.id);
  if (!ok) throw new AppError('Testimonial not found', 404);
  sendNoContent(res);
});

// ── Footer ─────────────────────────────────────────────────────────

const getFooter = asyncHandler(async (req, res) => {
  const data = await platformService.footer.getFooterPublic();
  sendSuccess(res, data);
});

const getFooterInternal = asyncHandler(async (req, res) => {
  const data = await platformService.footer.getFooterInternal();
  sendSuccess(res, data);
});

const upsertFooter = asyncHandler(async (req, res) => {
  const data = await platformService.footer.upsertFooter(req.params.key, req.body);
  sendSuccess(res, data);
});

// ── Plans ──────────────────────────────────────────────────────────

const getPlans = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getPlansPublic();
  sendSuccess(res, data);
});

const getPlanBySlug = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getPlanBySlugPublic(req.params.slug);
  if (!data) throw new AppError('Plan not found', 404);
  sendSuccess(res, data);
});

const getPlansInternal = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getPlansInternal();
  sendSuccess(res, data);
});

const getPlanByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getPlanByIdInternal(req.params.id);
  if (!data) throw new AppError('Plan not found', 404);
  sendSuccess(res, data);
});

const createPlan = asyncHandler(async (req, res) => {
  const data = await platformService.plans.createPlan(req.body);
  sendCreated(res, data);
});

const updatePlan = asyncHandler(async (req, res) => {
  const data = await platformService.plans.updatePlan(req.params.id, req.body);
  if (!data) throw new AppError('Plan not found', 404);
  sendSuccess(res, data);
});

const togglePlanPopular = asyncHandler(async (req, res) => {
  const data = await platformService.plans.togglePopular(req.params.id, req.body.is_popular);
  if (!data) throw new AppError('Plan not found', 404);
  sendSuccess(res, data);
});

const deletePlan = asyncHandler(async (req, res) => {
  const ok = await platformService.plans.deletePlan(req.params.id);
  if (!ok) throw new AppError('Plan not found', 404);
  sendNoContent(res);
});

// ── Comparison Features ────────────────────────────────────────────

const getComparisonFeatures = asyncHandler(async (req, res) => {
  const data = await platformService.comparisonFeatures.listComparisonFeatures();
  sendSuccess(res, data);
});

const createComparisonFeature = asyncHandler(async (req, res) => {
  const data = await platformService.comparisonFeatures.createComparisonFeature(req.body);
  sendCreated(res, data);
});

const updateComparisonFeature = asyncHandler(async (req, res) => {
  const data = await platformService.comparisonFeatures.updateComparisonFeature(req.params.id, req.body);
  if (!data) throw new AppError('Feature not found', 404);
  sendSuccess(res, data);
});

const deleteComparisonFeature = asyncHandler(async (req, res) => {
  const ok = await platformService.comparisonFeatures.deleteComparisonFeature(req.params.id);
  if (!ok) throw new AppError('Feature not found', 404);
  sendNoContent(res);
});

const setFeatureAvailability = asyncHandler(async (req, res) => {
  const { featureId, planId } = req.params;
  const { available } = req.body;
  const data = await platformService.comparisonFeatures.setFeatureAvailability(
    parseInt(planId, 10),
    parseInt(featureId, 10),
    !!available,
  );
  sendSuccess(res, data);
});

// ── Articles ───────────────────────────────────────────────────────

const getArticles = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const search = req.query.search ? String(req.query.search).trim() : undefined;
  const category = req.query.category ? String(req.query.category).trim() : undefined;
  const data = await platformService.articles.getArticlesPublic({ page, limit, search, category });
  sendSuccess(res, data);
});

const getArticleBySlug = asyncHandler(async (req, res) => {
  const data = await platformService.articles.getArticleBySlugPublic(req.params.slug, req.viewer || null);
  if (!data) throw new AppError('Article not found', 404);
  sendSuccess(res, data);
});

const getArticleUpNext = asyncHandler(async (req, res) => {
  const raw = req.query.limit;
  const parsed = raw !== undefined && raw !== '' ? parseInt(String(raw), 10) : NaN;
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
  /** At least 3, at most 10; default 6 when `limit` omitted. */
  const lim = Math.min(10, Math.max(3, requested));
  const data = await platformService.articles.getUpNextArticlesBySlugPublic(
    req.params.slug,
    req.viewer || null,
    lim,
  );
  sendSuccess(res, data);
});

const getBlogSpotlightFeed = asyncHandler(async (req, res) => {
  const recentLimit = parseInt(req.query.recent_limit ?? '3', 10);
  const allLimit = parseInt(req.query.all_limit ?? '6', 10);
  const authorRecentLimit = parseInt(req.query.author_recent_limit ?? '5', 10);
  const tagLimit = parseInt(req.query.tag_limit ?? '12', 10);
  const current_slug = req.query.current_slug ? String(req.query.current_slug).trim() : undefined;
  const data = await platformService.articles.getBlogSpotlightFeed(req.viewer || null, {
    recentLimit,
    allLimit,
    authorRecentLimit,
    tagLimit,
    currentSlug: current_slug || undefined,
  });
  sendSuccess(res, data);
});

const getArticlesInternal = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10)));
  const search = req.query.search ? String(req.query.search).trim() : undefined;
  const sortBy = req.query.sortBy ? String(req.query.sortBy).trim() : undefined;
  const sortOrder = (req.query.sortOrder && /^(ASC|DESC)$/i.test(req.query.sortOrder))
    ? req.query.sortOrder.toUpperCase()
    : 'DESC';

  const result = await platformService.articles.getArticlesInternal({
    status: req.query.status,
    page,
    limit,
    search: search || undefined,
    sortBy,
    sortOrder,
  });

  sendSuccess(res, result);
});

const getArticleByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articles.getArticleByIdInternal(req.params.id);
  if (!data) throw new AppError('Article not found', 404);
  sendSuccess(res, data);
});

const createArticle = asyncHandler(async (req, res) => {
  const data = await platformService.articles.createArticle(req.body);
  sendCreated(res, data);
});

const updateArticle = asyncHandler(async (req, res) => {
  const data = await platformService.articles.updateArticle(req.params.id, req.body);
  if (!data) throw new AppError('Article not found', 404);
  sendSuccess(res, data);
});

const deleteArticle = asyncHandler(async (req, res) => {
  const ok = await platformService.articles.deleteArticle(req.params.id);
  if (!ok) throw new AppError('Article not found', 404);
  sendNoContent(res);
});

// ── Lookups ────────────────────────────────────────────────────────

const getArticleCategories = asyncHandler(async (req, res) => {
  const data = await platformService.articleCategories.getArticleCategories();
  sendSuccess(res, data);
});

const getArticleCategoriesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articleCategories.getArticleCategories();
  sendSuccess(res, data);
});

const getArticleCategoryByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articleCategories.getArticleCategoryById(req.params.id);
  if (!data) throw new AppError('Category not found', 404);
  sendSuccess(res, data);
});

const createArticleCategory = asyncHandler(async (req, res) => {
  const data = await platformService.articleCategories.createArticleCategory(req.body);
  sendCreated(res, data);
});

const updateArticleCategory = asyncHandler(async (req, res) => {
  const data = await platformService.articleCategories.updateArticleCategory(req.params.id, req.body);
  if (!data) throw new AppError('Category not found', 404);
  sendSuccess(res, data);
});

const deleteArticleCategory = asyncHandler(async (req, res) => {
  const ok = await platformService.articleCategories.deleteArticleCategory(req.params.id);
  if (!ok) throw new AppError('Category not found', 404);
  sendNoContent(res);
});

const getTagsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.tags.getTagsInternal();
  sendSuccess(res, data);
});

const getArticleTypesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articleTypes.getArticleTypesInternal();
  sendSuccess(res, data);
});

const getCourtsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.courts.getCourtsInternal();
  sendSuccess(res, data);
});

// ── CMS pages ───────────────────────────────────────────────────────

const getCmsPageBySlug = asyncHandler(async (req, res) => {
  const data = await platformService.cmsPages.getCmsPageBySlug(req.params.slug);
  if (!data) throw new AppError('CMS page not found', 404);
  sendSuccess(res, data);
});

const getCmsPagesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.cmsPages.getCmsPagesInternal();
  sendSuccess(res, data);
});

const getCmsPageBySlugInternal = asyncHandler(async (req, res) => {
  const data = await platformService.cmsPages.getCmsPageBySlug(req.params.slug);
  if (!data) throw new AppError('CMS page not found', 404);
  sendSuccess(res, data);
});

const putCmsPageBySlug = asyncHandler(async (req, res) => {
  const data = await platformService.cmsPages.upsertCmsPageBySlug(req.params.slug, req.body);
  sendSuccess(res, data);
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.filename) throw new AppError('No file uploaded', 400);
  logger.info(`[uploadImage] saved → path: ${req.file.path}, size: ${req.file.size} bytes`);
  const rel = relativePathFromFile(uploadsDir, req.file.path);
  const url = publicMediaUrl(rel, 'platform');
  sendSuccess(res, { url });
});

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.filename) throw new AppError('No file uploaded', 400);
  logger.info(`[uploadFile] saved → path: ${req.file.path}, size: ${req.file.size} bytes`);
  const rel = relativePathFromFile(uploadsDir, req.file.path);
  const url = publicMediaUrl(rel, 'platform');
  sendSuccess(res, {
    url,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
});

// ── Media Assets ────────────────────────────────────────────────────

const getMediaAssets = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const data = await platformService.mediaAssets.getMediaAssetsInternal(category || null);
  sendSuccess(res, data);
});

const createMediaAsset = asyncHandler(async (req, res) => {
  const { url, label, category } = req.body;
  if (!url) throw new AppError('url is required', 400);
  const data = await platformService.mediaAssets.createMediaAsset({ url, label, category });
  sendCreated(res, data);
});

const deleteMediaAsset = asyncHandler(async (req, res) => {
  const result = await platformService.mediaAssets.deleteMediaAsset(req.params.id);
  if (!result) throw new AppError('Media asset not found', 404);
  sendNoContent(res);
});

// ── FAQs ───────────────────────────────────────────────────────────

const getFaqs = asyncHandler(async (req, res) => {
  const data = await platformService.faqs.getFaqsPublic();
  sendSuccess(res, data);
});

const getFaqsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.faqs.getFaqsInternal();
  sendSuccess(res, data);
});

const getFaqInternal = asyncHandler(async (req, res) => {
  const data = await platformService.faqs.getFaqByIdInternal(req.params.id);
  if (!data) throw new AppError('Faq not found', 404);
  sendSuccess(res, data);
});

const createFaq = asyncHandler(async (req, res) => {
  const data = await platformService.faqs.createFaq(req.body);
  sendCreated(res, data);
});

const updateFaq = asyncHandler(async (req, res) => {
  const data = await platformService.faqs.updateFaq(req.params.id, req.body);
  if (!data) throw new AppError('Faq not found', 404);
  sendSuccess(res, data);
});

const deleteFaq = asyncHandler(async (req, res) => {
  const ok = await platformService.faqs.deleteFaq(req.params.id);
  if (!ok) throw new AppError('Faq not found', 404);
  sendNoContent(res);
});

// ── Contact Inquiries ───────────────────────────────────────────────

const createContactInquiry = asyncHandler(async (req, res) => {
  const data = await platformService.contactInquiries.createContactInquiry(req.body);
  sendCreated(res, data);
});

const getContactInquiryInternal = asyncHandler(async (req, res) => {
  const data = await platformService.contactInquiries.getContactInquiry();
  sendSuccess(res, data);
});

// ── SEO Metadata ───────────────────────────────────────────────────

const getSeoMetadataInternal = asyncHandler(async (req, res) => {
  const data = await platformService.seo.getSeoMetadataInternal();
  sendSuccess(res, data);
});

const getSeoMetadataByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.seo.getSeoMetadataByIdInternal(req.params.id);
  if (!data) throw new AppError('SEO Metadata not found', 404);
  sendSuccess(res, data);
});

const getSeoMetadataBySlugPublic = asyncHandler(async (req, res) => {
  const data = await platformService.seo.getSeoMetadataBySlugPublic(req.params.slug);
  if (!data) throw new AppError('SEO Metadata not found', 404);
  sendSuccess(res, data);
});

/** Query ?path=/blogs/foo — supports multi-segment paths unlike /slug/:slug */
const getSeoMetadataByPathPublic = asyncHandler(async (req, res) => {
  const raw = typeof req.query?.path === 'string' ? req.query.path : '';
  const pathNorm = raw === '' ? '/' : raw.startsWith('/') ? raw : `/${raw}`;
  const data = await platformService.seo.getSeoMetadataBySlugPublic(pathNorm);
  if (!data) throw new AppError('SEO Metadata not found', 404);
  sendSuccess(res, data);
});

const createSeoMetadata = asyncHandler(async (req, res) => {
  const data = await platformService.seo.createSeoMetadata(req.body);
  sendCreated(res, data);
});

const updateSeoMetadata = asyncHandler(async (req, res) => {
  const data = await platformService.seo.updateSeoMetadata(req.params.id, req.body);
  if (!data) throw new AppError('SEO Metadata not found', 404);
  sendSuccess(res, data);
});

const deleteSeoMetadata = asyncHandler(async (req, res) => {
  const ok = await platformService.seo.deleteSeoMetadata(req.params.id);
  if (!ok) throw new AppError('SEO Metadata not found', 404);
  sendNoContent(res);
});

module.exports = {
  getHome,
  getHomeInternal,
  putHomePage,
  getStates,
  getStatesInternal,
  createState,
  updateState,
  getTestimonials,
  getTestimonialsInternal,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  getFaqs,
  getFaqsInternal,
  getFaqInternal,
  createFaq,
  updateFaq,
  deleteFaq,
  createContactInquiry,
  getContactInquiryInternal,
  getSeoMetadataInternal,
  getSeoMetadataByIdInternal,
  getSeoMetadataBySlugPublic,
  getSeoMetadataByPathPublic,
  createSeoMetadata,
  updateSeoMetadata,
  deleteSeoMetadata,
  getFooter,
  getFooterInternal,
  upsertFooter,
  getPlans,
  getPlanBySlug,
  getPlansInternal,
  getPlanByIdInternal,
  createPlan,
  updatePlan,
  togglePlanPopular,
  deletePlan,
  getComparisonFeatures,
  createComparisonFeature,
  updateComparisonFeature,
  deleteComparisonFeature,
  setFeatureAvailability,
  getArticles,
  getBlogSpotlightFeed,
  getArticleBySlug,
  getArticleUpNext,
  getArticlesInternal,
  getArticleByIdInternal,
  createArticle,
  updateArticle,
  deleteArticle,
  getArticleCategories,
  getArticleCategoriesInternal,
  getArticleCategoryByIdInternal,
  createArticleCategory,
  updateArticleCategory,
  deleteArticleCategory,
  getTagsInternal,
  getArticleTypesInternal,
  getCourtsInternal,
  getCmsPageBySlug,
  getCmsPagesInternal,
  getCmsPageBySlugInternal,
  putCmsPageBySlug,
  uploadImage,
  uploadFile,
  getMediaAssets,
  createMediaAsset,
  deleteMediaAsset,
};
