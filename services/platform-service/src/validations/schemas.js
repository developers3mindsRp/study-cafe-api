const Joi = require('joi');
const { ARTICLE_TAX_TYPE_VALUES } = require('../constants/articleTaxTypes');

// ── Param schemas ──────────────────────────────────────────────────

const idParam = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
};

const slugParam = {
    params: Joi.object({
        slug: Joi.string().max(500).required(),
    }),
};

const keyParam = {
    params: Joi.object({
        key: Joi.string().max(255).required(),
    }),
};

// ── Home (stored as cms_pages with slug='home') ──────────────────────

const upsertHomePage = {
    body: Joi.object({
        title: Joi.string().max(500).allow(null, ''),
        content: Joi.string().allow(null, ''),
        meta: Joi.object({
            hero: Joi.object({
                title: Joi.string().allow('', null),
                subtitle: Joi.string().allow('', null),
                ctaText: Joi.string().allow('', null),
                ctaLink: Joi.string().allow('', null),
                imageUrl: Joi.string().uri().allow('', null),
                badge: Joi.string().allow('', null),
            }),
            features: Joi.array().items(Joi.object({
                id: Joi.string().allow('', null),
                title: Joi.string().allow('', null),
                description: Joi.string().allow('', null),
                icon: Joi.string().allow('', null),
                order: Joi.number().integer().min(0),
            })),
            stats: Joi.array().items(Joi.object({
                label: Joi.string().allow('', null),
                value: Joi.alternatives().try(Joi.string(), Joi.number()),
                suffix: Joi.string().allow('', null),
            })),
        }).allow(null),
    }),
};

// ── States ──────────────────────────────────────────────────────────

const createState = {
    body: Joi.object({
        name: Joi.string().max(255).required(),
        code: Joi.string().max(10).allow('', null),
        is_active: Joi.boolean().default(true),
    }),
};

const updateState = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(255),
        code: Joi.string().max(10).allow('', null),
        is_active: Joi.boolean(),
    }),
};

// ── Google Reviews ────────────────────────────────────────────────────

const createGoogleReview = {
    body: Joi.object({
        author_name: Joi.string().max(255).required(),
        author_role: Joi.string().max(255).allow('', null),
        avatar_url: Joi.string().allow('', null),
        content: Joi.string().required(),
        rating: Joi.number().integer().min(1).max(5).allow(null),
        reviewed_at: Joi.string().max(64).allow('', null),
        is_active: Joi.boolean().default(true),
        sort_order: Joi.number().integer().min(0).default(0),
    }),
};

const updateGoogleReview = {
    params: idParam.params,
    body: Joi.object({
        author_name: Joi.string().max(255),
        author_role: Joi.string().max(255).allow('', null),
        avatar_url: Joi.string().allow('', null),
        content: Joi.string(),
        rating: Joi.number().integer().min(1).max(5).allow(null),
        reviewed_at: Joi.string().max(64).allow('', null),
        is_active: Joi.boolean(),
        sort_order: Joi.number().integer().min(0),
    }),
};

// ── Testimonials (video/image) ────────────────────────────────────────

const createTestimonial = {
    body: Joi.object({
        title: Joi.string().max(255).allow('', null),
        media_type: Joi.string().valid('video', 'image').default('video'),
        media_url: Joi.string().max(512).required(),
        video_url: Joi.string().max(512).allow('', null),
        is_active: Joi.boolean().default(true),
        sort_order: Joi.number().integer().min(0).default(0),
    }),
};

const updateTestimonial = {
    params: idParam.params,
    body: Joi.object({
        title: Joi.string().max(255).allow('', null),
        media_type: Joi.string().valid('video', 'image'),
        media_url: Joi.string().max(512),
        video_url: Joi.string().max(512).allow('', null),
        is_active: Joi.boolean(),
        sort_order: Joi.number().integer().min(0),
    }),
};

// ── FAQs ────────────────────────────────────────────────────────────

const createFaq = {
    body: Joi.object({
        question: Joi.string().required(),
        answer: Joi.string().required(),
        sort_order: Joi.number().integer().min(0),
        is_active: Joi.boolean().default(true),
    }),
};

const updateFaq = {
    params: idParam.params,
    body: Joi.object({
        question: Joi.string(),
        answer: Joi.string(),
        sort_order: Joi.number().integer().min(0),
        is_active: Joi.boolean(),
    }),
};

// ── Contact Us ───────────────────────────────────────────────────────

const createContactInquiry = {
    body: Joi.object({
        first_name: Joi.string().max(100).required(),
        last_name: Joi.string().max(100).required(),
        email: Joi.string().email().max(255).required(),
        mobile_number: Joi.string().max(30).required(),
        country_code: Joi.string().max(8).allow('', null).default('IN'),
        subject: Joi.string().max(255).allow('', null),
        message: Joi.string().max(5000).required(),
    }),
};

// ── Article Categories ──────────────────────────────────────────────

const createArticleCategory = {
    body: Joi.object({
        name: Joi.string().max(200).required(),
        slug: Joi.string().max(200).allow('', null),
        parent_id: Joi.number().integer().positive().allow(null),
        whatsapp_links: Joi.array().items(Joi.string().uri().max(500)).allow(null),
        telegram_links: Joi.array().items(Joi.string().uri().max(500)).allow(null),
        google_news_url: Joi.string().uri().max(500).allow('', null),
    }),
};

const updateArticleCategory = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(200),
        slug: Joi.string().max(200).allow('', null),
        parent_id: Joi.number().integer().positive().allow(null),
        whatsapp_links: Joi.array().items(Joi.string().uri().max(500)).allow(null),
        telegram_links: Joi.array().items(Joi.string().uri().max(500)).allow(null),
        google_news_url: Joi.string().uri().max(500).allow('', null),
    }),
};

// ── Article taxonomy masters (tags, types, courts) ─────────────────

const createTaxonomyTerm = {
    body: Joi.object({
        name: Joi.string().max(200).required(),
        slug: Joi.string().max(200).allow('', null),
    }),
};

const updateTaxonomyTerm = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(200),
        slug: Joi.string().max(200).allow('', null),
    }),
};

// ── Footer ──────────────────────────────────────────────────────────

const upsertFooter = {
    params: keyParam.params,
    body: Joi.object({
        data_value: Joi.alternatives().try(Joi.string(), Joi.object(), Joi.array()).allow(null),
        meta: Joi.object().unknown(true).allow(null),
    })
        .min(1)
        .messages({ 'object.min': 'body must include at least one of data_value, meta' }),
};

/** Full site display-ads document; unknown keys ignored at service merge step. */
const putSiteAds = {
    body: Joi.object().unknown(true),
};

/** global_settings.setting_key rows (tracking HTML, JSON blobs, future keys) */
const upsertGlobalSetting = {
    params: Joi.object({
        key: Joi.string().max(128).required(),
    }),
    body: Joi.object({
        value: Joi.string().allow('', null),
        meta: Joi.object().unknown(true).allow(null),
    })
        .min(1)
        .messages({ 'object.min': 'body must include at least value or meta' }),
};

// ── Plans ───────────────────────────────────────────────────────────

/** Legacy: string[] or HTML/plain string. Current admin: { mrp, included[], excluded[] } */
const planFeaturesBody = Joi.alternatives().try(
    Joi.array().items(Joi.string().allow('')),
    Joi.string().allow('', null),
    Joi.object({
        mrp: Joi.number().min(0),
        included: Joi.array().items(Joi.string().allow('')),
        excluded: Joi.array().items(Joi.string().allow('')),
    }),
).allow(null);

const createPlan = {
    body: Joi.object({
        name: Joi.string().max(255).required(),
        slug: Joi.string().max(255),
        description: Joi.string().allow('', null),
        price: Joi.number().min(0).required(),
        currency: Joi.string().max(10).allow('', null),
        sale_price: Joi.number().min(0).allow(null),
        duration_days: Joi.number().integer().min(1).allow(null),
        is_lifetime: Joi.boolean().default(false),
        features: planFeaturesBody,
        is_active: Joi.boolean().default(true),
        is_popular: Joi.boolean().default(false),
        sort_order: Joi.number().integer().min(0),
        tier_rank: Joi.number().integer().min(0).default(0),
        course_ids: Joi.array().items(Joi.number().integer().positive()),
        course_cat_ids: Joi.array().items(Joi.number().integer().positive()),
        courses: Joi.array().items(Joi.number().integer().positive()),
        categories: Joi.array().items(Joi.number().integer().positive()),
        affiliate_commission: Joi.number().min(0).max(100).default(0),
    }),
};

const updatePlan = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(255),
        slug: Joi.string().max(255),
        description: Joi.string().allow('', null),
        price: Joi.number().min(0),
        currency: Joi.string().max(10).allow('', null),
        sale_price: Joi.number().min(0).allow(null),
        duration_days: Joi.number().integer().min(1).allow(null),
        is_lifetime: Joi.boolean(),
        features: planFeaturesBody,
        is_active: Joi.boolean(),
        is_popular: Joi.boolean(),
        sort_order: Joi.number().integer().min(0),
        tier_rank: Joi.number().integer().min(0),
        course_ids: Joi.array().items(Joi.number().integer().positive()),
        course_cat_ids: Joi.array().items(Joi.number().integer().positive()),
        courses: Joi.array().items(Joi.number().integer().positive()),
        categories: Joi.array().items(Joi.number().integer().positive()),
        affiliate_commission: Joi.number().min(0).max(100),
    }),
};

// ── Articles ────────────────────────────────────────────────────────

// ── Course ⇄ Plan (membership) links (plan_courses) ─────────────────
const coursePlansParam = {
    params: Joi.object({
        courseId: Joi.number().integer().positive().required(),
    }),
};

const setCoursePlans = {
    params: coursePlansParam.params,
    body: Joi.object({
        plan_ids: Joi.array().items(Joi.number().integer().positive()).default([]),
    }),
};

const articleListQuery = {
    query: Joi.object({
        page: Joi.number().integer().min(1).default(1),
        limit: Joi.number().integer().min(1).max(100).default(10),
        status: Joi.string().valid('draft', 'publish', 'archived', 'scheduled').allow('', null),
        search: Joi.string().max(255).allow('', null),
        sortBy: Joi.string().max(64).allow('', null),
        sortOrder: Joi.string().valid('ASC', 'DESC', 'asc', 'desc').default('DESC'),
        category_id: Joi.number().integer().min(1).allow('', null),
        blog_access_tier: Joi.string().valid('free', 'premium').allow('', null),
        author: Joi.string().max(255).allow('', null),
        date_from: Joi.string().isoDate().allow('', null),
        date_to: Joi.string().isoDate().allow('', null),
        trashed: Joi.string().valid('1', 'true', 'only').allow('', null),
    }),
};

const articleWriteBody = {
    title: Joi.string().max(500),
    slug: Joi.string().max(500).allow('', null),
    content: Joi.string().allow('', null),
    body: Joi.string().allow('', null),
    excerpt: Joi.string().allow('', null),
    sub_heading: Joi.string().allow('', null),
    thumbnail: Joi.string().max(500).allow('', null),
    thumbnail_url: Joi.string().max(500).allow('', null),
    status: Joi.string().valid('draft', 'publish', 'archived', 'scheduled'),
    seo_title: Joi.string().max(255).allow('', null),
    seo_description: Joi.string().allow('', null),
    seo_keywords: Joi.string().allow('', null),
    meta_title: Joi.string().max(500).allow('', null),
    meta_description: Joi.string().allow('', null),
    meta_keywords: Joi.string().max(500).allow('', null),
    canonical_url: Joi.string().max(1000).allow('', null),
    robots: Joi.string().max(255).allow('', null),
    og_title: Joi.string().max(255).allow('', null),
    og_description: Joi.string().allow('', null),
    og_image_url: Joi.string().max(500).allow('', null),
    thumbnail_alt: Joi.string().max(500).allow('', null),
    thumbnail_link_url: Joi.string().max(500).allow('', null),
    thumbnail_caption: Joi.string().allow('', null),
    categories: Joi.array().items(Joi.number().integer().positive()),
    tags: Joi.array().items(Joi.number().integer().positive()),
    types: Joi.array().items(Joi.number().integer().positive()),
    courts: Joi.array().items(Joi.number().integer().positive()),
    category_ids: Joi.array().items(Joi.number().integer().positive()),
    tag_ids: Joi.array().items(Joi.number().integer().positive()),
    /** Comma-separated tag labels from admin; merged with tag_ids (tags are find-or-created by name). */
    tag_labels: Joi.array().items(Joi.string().max(200)).optional(),
    article_type_ids: Joi.array().items(Joi.number().integer().positive()),
    court_ids: Joi.array().items(Joi.number().integer().positive()),
    author_id: Joi.number().integer().positive().allow(null),
    published_at: Joi.alternatives().try(Joi.date(), Joi.string().allow('', null)),
    scheduled_publish_at: Joi.alternatives().try(Joi.date(), Joi.string().allow('', null)),
    /** Public blog: full HTML for everyone vs members-only full body. */
    blog_access_tier: Joi.string().valid('free', 'premium'),
    /** Downloadable asset URL (PDF / judgment). */
    rel_download_url: Joi.string().max(1000).allow('', null),
    /** JSON payload for Case Citation metadata */
    citation: Joi.alternatives().try(
        Joi.string().allow('', null),
        Joi.object().unknown(true).allow(null)
    ).allow(null),
    /** Notification metadata (tax notifications) */
    noti_no: Joi.string().max(200).allow('', null),
    noti_date: Joi.string().max(100).allow('', null),
    type_of_tax: Joi.string().valid(...ARTICLE_TAX_TYPE_VALUES).allow('', null),
    /** Ordered article sections (title + rich content); drive the TOC + composed body. */
    sections: Joi.array().items(Joi.object({
        title: Joi.string().allow('', null),
        content: Joi.string().allow('', null),
        sort_order: Joi.number().integer().optional(),
    })).optional(),
};

const createArticle = {
    body: Joi.object({
        ...articleWriteBody,
        title: Joi.string().max(500).required(),
        status: Joi.string().valid('draft', 'publish', 'archived', 'scheduled').default('draft'),
        blog_access_tier: Joi.string().valid('free', 'premium').default('free'),
    }),
};

const updateArticle = {
    params: idParam.params,
    body: Joi.object(articleWriteBody).fork('author_id', () => Joi.any().strip()),
};

// ── CMS pages ────────────────────────────────────────────────────────

const upsertCmsPage = {
    params: slugParam.params,
    body: Joi.object({
        title: Joi.string().max(500).allow('', null),
        content: Joi.string().allow('', null),
        meta: Joi.object().unknown(true).allow(null),
    }),
};

const createSeoMetadata = {
    body: Joi.object({
        page_name: Joi.string().max(255).required(),
        page_slug: Joi.string().max(255).required(),
        meta_title: Joi.string().max(255).required(),
        meta_description: Joi.string().allow('', null),
        meta_keywords: Joi.string().max(500).allow('', null),
        canonical_url: Joi.string().max(500).allow('', null),
        og_title: Joi.string().max(255).allow('', null),
        og_description: Joi.string().allow('', null),
        og_image_url: Joi.string().max(500).allow('', null),
        robots: Joi.string().max(255).allow('', null),
    }),
};

const createSiteSeoRoute = {
    body: Joi.object({
        path: Joi.string().max(500).required(),
        label: Joi.string().max(500).required(),
        sort_order: Joi.number().integer().min(0).default(0),
    }),
};

const updateSiteSeoRoute = {
    params: idParam.params,
    body: Joi.object({
        path: Joi.string().max(500),
        label: Joi.string().max(500),
        sort_order: Joi.number().integer().min(0),
    })
        .min(1)
        .required(),
};

const syncModuleSeoMetadata = {
    body: Joi.object({
        paths: Joi.array().items(Joi.string().max(500)).min(1).required(),
        remove_paths: Joi.array().items(Joi.string().max(500)),
        page_name: Joi.string().max(255).allow('', null),
        meta_title: Joi.string().max(255).required(),
        meta_description: Joi.string().allow('', null),
        meta_keywords: Joi.string().max(500).allow('', null),
        canonical_url: Joi.string().max(500).allow('', null),
        og_title: Joi.string().max(255).allow('', null),
        og_description: Joi.string().allow('', null),
        og_image_url: Joi.string().max(500).allow('', null),
        robots: Joi.string().max(255).allow('', null),
    }),
};

const updateSeoMetadata = {
    params: idParam.params,
    body: Joi.object({
        page_name: Joi.string().max(255),
        page_slug: Joi.string().max(255),
        meta_title: Joi.string().max(255),
        meta_description: Joi.string().allow('', null),
        meta_keywords: Joi.string().max(500).allow('', null),
        canonical_url: Joi.string().max(500).allow('', null),
        og_title: Joi.string().max(255).allow('', null),
        og_description: Joi.string().allow('', null),
        og_image_url: Joi.string().max(500).allow('', null),
        robots: Joi.string().max(255).allow('', null),
    }),
};

// ── Newsletter ──────────────────────────────────────────────────────

const subscribeNewsletter = {
    body: Joi.object({
        email: Joi.string().email().max(255).required(),
    }),
};

const unsubscribeNewsletter = {
    query: Joi.object({
        token: Joi.string().max(64).required(),
    }),
};

const createNewsletterTemplate = {
    body: Joi.object({
        name: Joi.string().max(255).required(),
        subject: Joi.string().max(500).required(),
        html_content: Joi.string().required(),
    }),
};

const updateNewsletterTemplate = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(255),
        subject: Joi.string().max(500),
        html_content: Joi.string(),
    }),
};

const sendNewsletter = {
    body: Joi.object({
        template_id: Joi.number().integer().positive().required(),
        custom_subject: Joi.string().max(500).allow('', null),
        custom_content: Joi.string().allow('', null),
        send_to: Joi.alternatives()
            .try(
                Joi.string().valid('all'),
                Joi.array().items(Joi.string().email()).min(1),
            )
            .default('all'),
    }),
};

/** Full URL path SEO lookup (?path=/blogs/foo), avoids single-segment :slug limitation */
const seoByPathQuery = {
    query: Joi.object({
        path: Joi.string().max(500).default('/'),
    }),
};

const createMediaAsset = {
    body: Joi.object({
        url: Joi.string().uri().required(),
        label: Joi.string().max(255).allow('', null),
        mime_type: Joi.string().max(128).allow('', null),
        category: Joi.string().max(50).default('library'),
    }),
};

const mediaAssetsListQuery = {
    query: Joi.object({
        category: Joi.string().max(64).allow('', null),
        type: Joi.string().valid('image', 'document', 'all').allow('', null),
        search: Joi.string().max(200).allow('', null),
        page: Joi.number().integer().min(1).allow('', null),
        limit: Joi.number().integer().min(1).max(100).default(24),
    }),
};

const acquireArticleEditLock = {
    params: idParam.params,
    body: Joi.object({
        user_id: Joi.number().integer().positive().required(),
    }),
};

const releaseArticleEditLock = {
    params: idParam.params,
    query: Joi.object({
        user_id: Joi.number().integer().positive().required(),
    }),
};

module.exports = {
    idParam,
    slugParam,
    keyParam,
    seoByPathQuery,
    upsertHomePage,
    createState,
    updateState,
    createGoogleReview,
    updateGoogleReview,
    createTestimonial,
    updateTestimonial,
    createFaq,
    updateFaq,
    createContactInquiry,
    upsertFooter,
    putSiteAds,
    upsertGlobalSetting,
    createPlan,
    updatePlan,
    coursePlansParam,
    setCoursePlans,
    articleListQuery,
    createArticle,
    updateArticle,
    acquireArticleEditLock,
    releaseArticleEditLock,
    createArticleCategory,
    updateArticleCategory,
    createTaxonomyTerm,
    updateTaxonomyTerm,
    upsertCmsPage,
    createSeoMetadata,
    updateSeoMetadata,
    syncModuleSeoMetadata,
    createSiteSeoRoute,
    updateSiteSeoRoute,
    subscribeNewsletter,
    unsubscribeNewsletter,
    createNewsletterTemplate,
    updateNewsletterTemplate,
    sendNewsletter,
    createMediaAsset,
    mediaAssetsListQuery,
};
