const fs = require('fs');
const platformService = require('../services/platform.service');
const telegramService = require('../services/telegram.service');
const membershipUpgradeService = require('../services/membership-upgrade.service');
const articlePreviewTokenService = require('../services/articlePreviewToken.service');
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

// ── Google Reviews ─────────────────────────────────────────────────

const getGoogleReviews = asyncHandler(async (req, res) => {
  const data = await platformService.googleReviews.getGoogleReviewsPublic();
  sendSuccess(res, data);
});

const getGoogleReviewsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.googleReviews.getGoogleReviewsInternal();
  sendSuccess(res, data);
});

const createGoogleReview = asyncHandler(async (req, res) => {
  const data = await platformService.googleReviews.createGoogleReview(req.body);
  sendCreated(res, data);
});

const updateGoogleReview = asyncHandler(async (req, res) => {
  const data = await platformService.googleReviews.updateGoogleReview(req.params.id, req.body);
  if (!data) throw new AppError('Google review not found', 404);
  sendSuccess(res, data);
});

const deleteGoogleReview = asyncHandler(async (req, res) => {
  const ok = await platformService.googleReviews.deleteGoogleReview(req.params.id);
  if (!ok) throw new AppError('Google review not found', 404);
  sendNoContent(res);
});

// ── Testimonials (video/image) ─────────────────────────────────────

const getTestimonials = asyncHandler(async (req, res) => {
  const data = await platformService.testimonials.getTestimonialsPublic();
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

// ── Products ("Our Products") ──────────────────────────────────────

const getProducts = asyncHandler(async (req, res) => {
  const data = await platformService.products.getProductsPublic();
  sendSuccess(res, data);
});

const getProductsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.products.getProductsInternal();
  sendSuccess(res, data);
});

const createProduct = asyncHandler(async (req, res) => {
  const data = await platformService.products.createProduct(req.body);
  sendCreated(res, data);
});

const updateProduct = asyncHandler(async (req, res) => {
  const data = await platformService.products.updateProduct(req.params.id, req.body);
  if (!data) throw new AppError('Product not found', 404);
  sendSuccess(res, data);
});

const deleteProduct = asyncHandler(async (req, res) => {
  const ok = await platformService.products.deleteProduct(req.params.id);
  if (!ok) throw new AppError('Product not found', 404);
  sendNoContent(res);
});

// ── Professions ────────────────────────────────────────────────────

const getProfessions = asyncHandler(async (req, res) => {
  const data = await platformService.professions.getProfessionsPublic();
  sendSuccess(res, { data });
});

const getProfessionsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.professions.getProfessionsInternal();
  sendSuccess(res, data);
});

const getProfessionInternal = asyncHandler(async (req, res) => {
  const data = await platformService.professions.getProfessionByIdInternal(req.params.id);
  if (!data) throw new AppError('Profession not found', 404);
  sendSuccess(res, data);
});

const createProfession = asyncHandler(async (req, res) => {
  const data = await platformService.professions.createProfession(req.body);
  sendCreated(res, data);
});

const updateProfession = asyncHandler(async (req, res) => {
  const data = await platformService.professions.updateProfession(req.params.id, req.body);
  if (!data) throw new AppError('Profession not found', 404);
  sendSuccess(res, data);
});

const deleteProfession = asyncHandler(async (req, res) => {
  const ok = await platformService.professions.deleteProfession(req.params.id);
  if (!ok) throw new AppError('Profession not found', 404);
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

const getGlobalSettingsSnippetsPublic = asyncHandler(async (req, res) => {
  const data = await platformService.globalSettings.getPublicSnippets();
  sendSuccess(res, data);
});

const getGlobalSettingsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.globalSettings.getAllMap();
  sendSuccess(res, data);
});

const putGlobalSetting = asyncHandler(async (req, res) => {
  const data = await platformService.globalSettings.upsert(req.params.key, req.body);
  sendSuccess(res, data);
});

const getSiteAds = asyncHandler(async (req, res) => {
  const data = await platformService.siteAds.getSiteAdsPublic();
  sendSuccess(res, data);
});

const putSiteAds = asyncHandler(async (req, res) => {
  const data = await platformService.siteAds.putSiteAds(req.body);
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

const getMembershipUpgradeSummary = asyncHandler(async (req, res) => {
  const userId = req.headers['x-user-id'];
  if (!userId) throw new AppError('Authentication required', 401);
  const { targetPlanId, couponCode } = req.body;
  if (!targetPlanId) throw new AppError('targetPlanId is required', 400);
  const data = await membershipUpgradeService.calculateMembershipUpgrade(
    userId,
    targetPlanId,
    couponCode || null
  );
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

const getPlanLinkedCoursesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getPlanLinkedCoursesInternal(req.params.id);
  sendSuccess(res, data);
});

const getCoursePlanIdsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getCoursePlanIdsInternal(req.params.courseId);
  sendSuccess(res, data);
});

const setCoursePlanIdsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.plans.setCoursePlanIdsInternal(
    req.params.courseId,
    req.body.plan_ids
  );
  sendSuccess(res, data);
});

const getPlanCoursesMapInternal = asyncHandler(async (req, res) => {
  const data = await platformService.plans.getPlanCoursesMapInternal();
  sendSuccess(res, data);
});

const listPlansByIdsInternal = asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter(Boolean);
  const plans = await platformService.plans.listPlansByIds(ids);
  sendSuccess(res, plans);
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
  const accessTier = req.query.access_tier ? String(req.query.access_tier).trim() : undefined;
  // Opt-out only: anything other than an explicit false/0 keeps the (costly) total count ,
  // so existing paginated callers are unaffected.
  const rawWithTotal = req.query.with_total;
  const withTotal = !(rawWithTotal === 'false' || rawWithTotal === '0');
  // Opt-in: include_content renders the article HTML on top of the metadata — a LONGTEXT read
  // per row plus a sanitize pass per article, too heavy to run on every list request.
  const rawIncludeContent = req.query.include_content;
  const includeContent = rawIncludeContent === 'true' || rawIncludeContent === '1';
  const data = await platformService.articles.getArticlesPublic({
    page,
    limit,
    search,
    category,
    accessTier,
    withTotal,
    includeContent,
    viewer: req.viewer || null,
  });
  sendSuccess(res, data);
});

const getCaseLaws = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
  const search = req.query.search ? String(req.query.search).trim() : undefined;
  const court = req.query.court ? String(req.query.court).trim() : undefined;
  const taxType = req.query.tax_type ? String(req.query.tax_type).trim() : undefined;
  const sort = req.query.sort === 'oldest' ? 'oldest' : 'latest';
  const data = await platformService.articles.getCaseLawsPublic({
    page,
    limit,
    search,
    court,
    taxType,
    sort,
    viewer: req.viewer || null,
  });
  sendSuccess(res, data);
});

/** Court + tax-type options for the public case-law filter bar. */
const getCaseLawFilters = asyncHandler(async (req, res) => {
  const data = await platformService.articles.getCaseLawFilterOptionsPublic();
  sendSuccess(res, data);
});

const getArticleBySlug = asyncHandler(async (req, res) => {
  const previewToken = typeof req.query.preview_token === 'string' ? req.query.preview_token : null;
  const data = await platformService.articles.getArticleBySlugPublic(req.params.slug, req.viewer || null, previewToken);
  if (!data) throw new AppError('Article not found', 404);
  sendSuccess(res, data);
});

const createArticlePreviewToken = asyncHandler(async (req, res) => {
  const articleId = Number(req.params.id);
  if (!Number.isFinite(articleId) || articleId <= 0) throw new AppError('Invalid article id', 400);
  const token = articlePreviewTokenService.createPreviewToken(articleId);
  sendSuccess(res, { token, expiresInSeconds: 900 });
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
  const category_id = req.query.category_id ? parseInt(req.query.category_id, 10) : undefined;
  const blog_access_tier = req.query.blog_access_tier || undefined;
  const author = req.query.author ? String(req.query.author).trim() : undefined;
  const date_from = req.query.date_from || undefined;
  const date_to = req.query.date_to || undefined;

  const result = await platformService.articles.getArticlesInternal({
    status: req.query.status,
    page,
    limit,
    search: search || undefined,
    sortBy,
    sortOrder,
    category_id,
    blog_access_tier,
    author: author || undefined,
    date_from,
    date_to,
    trashed: req.query.trashed,
  });

  sendSuccess(res, result);
});

const getArticleByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articles.getArticleByIdInternal(req.params.id);
  if (!data) throw new AppError('Article not found', 404);
  sendSuccess(res, data);
});

const getArticleStatusCounts = asyncHandler(async (req, res) => {
  const data = await platformService.articles.getArticleStatusCounts();
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

const restoreArticle = asyncHandler(async (req, res) => {
  const ok = await platformService.articles.restoreArticle(req.params.id);
  if (!ok) throw new AppError('Article not found in trash', 404);
  sendNoContent(res);
});

const deleteArticlePermanently = asyncHandler(async (req, res) => {
  const result = await platformService.articles.deleteArticlePermanently(req.params.id);
  if (!result.ok) {
    if (result.reason === 'not_trashed') {
      throw new AppError('Article must be moved to trash before permanent deletion', 400);
    }
    throw new AppError('Article not found', 404);
  }
  sendNoContent(res);
});

/**
 * Manually (re-)post an article to the Telegram group. Intended for local
 * testing and one-off re-sends from the admin panel. Pass ?force=true to
 * bypass the once-only guard and re-post an already-announced article.
 */
const postArticleToTelegram = asyncHandler(async (req, res) => {
  const force = req.query.force === 'true' || req.query.force === '1';
  const result = await telegramService.notifyArticlePublished(Number(req.params.id), { force });
  if (!result.ok) {
    const status = result.skipped === 'not_found' ? 404 : 400;
    throw new AppError(`Telegram post not sent: ${result.error || result.skipped}`, status);
  }
  sendSuccess(res, result);
});

const getArticleEditLock = asyncHandler(async (req, res) => {
  const data = await platformService.articles.getArticleEditLock(req.params.id);
  sendSuccess(res, data);
});

const acquireArticleEditLock = asyncHandler(async (req, res) => {
  const data = await platformService.articles.acquireArticleEditLock(req.params.id, req.body.user_id);
  if (!data) throw new AppError('Article not found', 404);
  sendSuccess(res, data);
});

const releaseArticleEditLock = asyncHandler(async (req, res) => {
  await platformService.articles.releaseArticleEditLock(req.params.id, req.query.user_id);
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

const getTagByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.tags.getTagById(req.params.id);
  if (!data) throw new AppError('Tag not found', 404);
  sendSuccess(res, data);
});

const createTag = asyncHandler(async (req, res) => {
  const data = await platformService.tags.createTag(req.body);
  sendCreated(res, data);
});

const updateTag = asyncHandler(async (req, res) => {
  const data = await platformService.tags.updateTag(req.params.id, req.body);
  if (!data) throw new AppError('Tag not found', 404);
  sendSuccess(res, data);
});

const deleteTag = asyncHandler(async (req, res) => {
  const ok = await platformService.tags.deleteTag(req.params.id);
  if (!ok) throw new AppError('Tag not found', 404);
  sendNoContent(res);
});

const getArticleTypesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articleTypes.getArticleTypesInternal();
  sendSuccess(res, data);
});

const getArticleTypeByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.articleTypes.getArticleTypeById(req.params.id);
  if (!data) throw new AppError('Article type not found', 404);
  sendSuccess(res, data);
});

const createArticleType = asyncHandler(async (req, res) => {
  const data = await platformService.articleTypes.createArticleType(req.body);
  sendCreated(res, data);
});

const updateArticleType = asyncHandler(async (req, res) => {
  const data = await platformService.articleTypes.updateArticleType(req.params.id, req.body);
  if (!data) throw new AppError('Article type not found', 404);
  sendSuccess(res, data);
});

const deleteArticleType = asyncHandler(async (req, res) => {
  const ok = await platformService.articleTypes.deleteArticleType(req.params.id);
  if (!ok) throw new AppError('Article type not found', 404);
  sendNoContent(res);
});

const getCourtsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.courts.getCourtsInternal();
  sendSuccess(res, data);
});

const getCourtByIdInternal = asyncHandler(async (req, res) => {
  const data = await platformService.courts.getCourtById(req.params.id);
  if (!data) throw new AppError('Court not found', 404);
  sendSuccess(res, data);
});

const createCourt = asyncHandler(async (req, res) => {
  const data = await platformService.courts.createCourt(req.body);
  sendCreated(res, data);
});

const updateCourt = asyncHandler(async (req, res) => {
  const data = await platformService.courts.updateCourt(req.params.id, req.body);
  if (!data) throw new AppError('Court not found', 404);
  sendSuccess(res, data);
});

const deleteCourt = asyncHandler(async (req, res) => {
  const ok = await platformService.courts.deleteCourt(req.params.id);
  if (!ok) throw new AppError('Court not found', 404);
  sendNoContent(res);
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
  if (!req.file.path || !fs.existsSync(req.file.path)) {
    logger.error(`[uploadImage] file missing on disk after multer — path: ${req.file.path}`);
    throw new AppError('Upload failed: file was not written to storage', 500);
  }
  logger.info(`[uploadImage] saved → path: ${req.file.path}, size: ${req.file.size} bytes`);
  const rel = relativePathFromFile(uploadsDir, req.file.path);
  const url = publicMediaUrl(rel, 'platform');
  const label = (req.file.originalname || '').replace(/\.[^.]+$/, '') || null;
  try {
    await platformService.mediaAssets.createMediaAsset({
      url,
      label,
      category: 'library',
      mime_type: req.file.mimetype || null,
    });
  } catch (err) {
    logger.warn(`[uploadImage] media registry skipped (upload still OK): ${err.message}`);
  }
  sendSuccess(res, { url });
});

const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.filename) throw new AppError('No file uploaded', 400);
  if (!req.file.path || !fs.existsSync(req.file.path)) {
    logger.error(`[uploadFile] file missing on disk after multer — path: ${req.file.path}`);
    throw new AppError('Upload failed: file was not written to storage', 500);
  }
  logger.info(`[uploadFile] saved → path: ${req.file.path}, size: ${req.file.size} bytes`);
  const rel = relativePathFromFile(uploadsDir, req.file.path);
  const url = publicMediaUrl(rel, 'platform');
  const label = (req.file.originalname || '').replace(/\.[^.]+$/, '') || null;
  try {
    await platformService.mediaAssets.createMediaAsset({
      url,
      label,
      category: 'library',
      mime_type: req.file.mimetype || null,
    });
  } catch (err) {
    logger.warn(`[uploadFile] media registry skipped (upload still OK): ${err.message}`);
  }
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
  const { category, type, search, page, limit } = req.query;
  const data = await platformService.mediaAssets.getMediaAssetsInternal({
    category: category || null,
    type: type || null,
    search: search || null,
    page: page ?? null,
    limit: limit ?? 24,
  });
  sendSuccess(res, data);
});

const createMediaAsset = asyncHandler(async (req, res) => {
  const { url, label, category, mime_type } = req.body;
  if (!url) throw new AppError('url is required', 400);
  const data = await platformService.mediaAssets.createMediaAsset({
    url,
    label,
    category,
    mime_type,
  });
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
  const includeModulePaths =
    req.query.include_module_paths === '1'
    || req.query.include_module_paths === 'true';
  const data = await platformService.seo.getSeoMetadataInternal({ includeModulePaths });
  sendSuccess(res, data);
});

const getSeoEligiblePagesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.seo.getSeoEligiblePagesInternal();
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
/**
 * Public lookup — Next.js edge middleware calls this for every request.
 *
 * "No SEO row for this path" is the normal answer for most pages, not an
 * error, so it returns 200 with `data: null`. Answering 404 made every page
 * view log two nginx errors and buried real broken URLs in the access log.
 */
const getSeoMetadataByPathPublic = asyncHandler(async (req, res) => {
  const raw = typeof req.query?.path === 'string' ? req.query.path : '';
  const pathNorm = raw === '' ? '/' : raw.startsWith('/') ? raw : `/${raw}`;
  const data = await platformService.seo.getSeoMetadataBySlugPublic(pathNorm);
  sendSuccess(res, data || null);
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

const syncModuleSeoMetadata = asyncHandler(async (req, res) => {
  await platformService.seo.syncModuleSeoMetadataInternal(req.body);
  sendSuccess(res, { ok: true });
});

const listSiteSeoRoutesInternal = asyncHandler(async (req, res) => {
  const data = await platformService.siteSeoRoutes.listSiteSeoRoutesInternal();
  sendSuccess(res, data);
});

const createSiteSeoRoute = asyncHandler(async (req, res) => {
  const data = await platformService.siteSeoRoutes.createSiteSeoRoute(req.body);
  sendCreated(res, data);
});

const updateSiteSeoRoute = asyncHandler(async (req, res) => {
  const data = await platformService.siteSeoRoutes.updateSiteSeoRoute(req.params.id, req.body);
  if (!data) throw new AppError('Site route not found', 404);
  sendSuccess(res, data);
});

const deleteSiteSeoRoute = asyncHandler(async (req, res) => {
  const ok = await platformService.siteSeoRoutes.deleteSiteSeoRoute(req.params.id);
  if (!ok) throw new AppError('Site route not found', 404);
  sendNoContent(res);
});

const listRedirectsInternal = asyncHandler(async (req, res) => {
  const data = await platformService.redirects.listRedirectsInternal();
  sendSuccess(res, data);
});

const createRedirect = asyncHandler(async (req, res) => {
  const data = await platformService.redirects.createRedirect(req.body);
  sendCreated(res, data);
});

const updateRedirect = asyncHandler(async (req, res) => {
  const data = await platformService.redirects.updateRedirect(req.params.id, req.body);
  if (!data) throw new AppError('Redirect not found', 404);
  sendSuccess(res, data);
});

const deleteRedirect = asyncHandler(async (req, res) => {
  const ok = await platformService.redirects.deleteRedirect(req.params.id);
  if (!ok) throw new AppError('Redirect not found', 404);
  sendNoContent(res);
});

/**
 * Public lookup — Next.js edge middleware calls this for every request to
 * resolve old → new paths.
 *
 * "No redirect for this path" is the normal answer, not an error, so it
 * returns 200 with `data: null`. See `getSeoMetadataByPathPublic`.
 */
const getRedirectByPathPublic = asyncHandler(async (req, res) => {
  const raw = typeof req.query?.path === 'string' ? req.query.path : '';
  const pathNorm = raw === '' ? '/' : raw.startsWith('/') ? raw : `/${raw}`;
  const data = await platformService.redirects.resolveRedirectByPath(pathNorm);
  sendSuccess(res, data || null);
});

module.exports = {
  getHome,
  getHomeInternal,
  putHomePage,
  getStates,
  getStatesInternal,
  createState,
  updateState,
  getGoogleReviews,
  getGoogleReviewsInternal,
  createGoogleReview,
  updateGoogleReview,
  deleteGoogleReview,
  getTestimonials,
  getTestimonialsInternal,
  createTestimonial,
  updateTestimonial,
  deleteTestimonial,
  getProducts,
  getProductsInternal,
  createProduct,
  updateProduct,
  deleteProduct,
  getProfessions,
  getProfessionsInternal,
  getProfessionInternal,
  createProfession,
  updateProfession,
  deleteProfession,
  getFaqs,
  getFaqsInternal,
  getFaqInternal,
  createFaq,
  updateFaq,
  deleteFaq,
  createContactInquiry,
  getContactInquiryInternal,
  getSeoMetadataInternal,
  getSeoEligiblePagesInternal,
  getSeoMetadataByIdInternal,
  getSeoMetadataBySlugPublic,
  getSeoMetadataByPathPublic,
  createSeoMetadata,
  updateSeoMetadata,
  deleteSeoMetadata,
  syncModuleSeoMetadata,
  listSiteSeoRoutesInternal,
  createSiteSeoRoute,
  updateSiteSeoRoute,
  deleteSiteSeoRoute,
  listRedirectsInternal,
  createRedirect,
  updateRedirect,
  deleteRedirect,
  getRedirectByPathPublic,
  getFooter,
  getFooterInternal,
  upsertFooter,
  getGlobalSettingsSnippetsPublic,
  getGlobalSettingsInternal,
  putGlobalSetting,
  getSiteAds,
  putSiteAds,
  getPlans,
  getPlanBySlug,
  getMembershipUpgradeSummary,
  getPlansInternal,
  getPlanByIdInternal,
  createPlan,
  updatePlan,
  togglePlanPopular,
  deletePlan,
  getPlanLinkedCoursesInternal,
  getCoursePlanIdsInternal,
  setCoursePlanIdsInternal,
  getPlanCoursesMapInternal,
  listPlansByIdsInternal,
  getComparisonFeatures,
  createComparisonFeature,
  updateComparisonFeature,
  deleteComparisonFeature,
  setFeatureAvailability,
  getArticles,
  getCaseLaws,
  getCaseLawFilters,
  getBlogSpotlightFeed,
  getArticleBySlug,
  createArticlePreviewToken,
  getArticleUpNext,
  getArticlesInternal,
  getArticleByIdInternal,
  getArticleStatusCounts,
  createArticle,
  updateArticle,
  deleteArticle,
  deleteArticlePermanently,
  restoreArticle,
  getArticleEditLock,
  acquireArticleEditLock,
  releaseArticleEditLock,
  postArticleToTelegram,
  getArticleCategories,
  getArticleCategoriesInternal,
  getArticleCategoryByIdInternal,
  createArticleCategory,
  updateArticleCategory,
  deleteArticleCategory,
  getTagsInternal,
  getTagByIdInternal,
  createTag,
  updateTag,
  deleteTag,
  getArticleTypesInternal,
  getArticleTypeByIdInternal,
  createArticleType,
  updateArticleType,
  deleteArticleType,
  getCourtsInternal,
  getCourtByIdInternal,
  createCourt,
  updateCourt,
  deleteCourt,
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
