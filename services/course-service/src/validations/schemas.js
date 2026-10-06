const Joi = require('joi');

// ── Param schemas ──────────────────────────────────────────────────

const idParam = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
};

const slugParam = {
    params: Joi.object({
        slug: Joi.string().max(200).required(),
    }),
};

const marketingMetaSchema = Joi.object({
    announcement_text: Joi.string().allow('', null),
    headline: Joi.string().allow('', null),
    subheadline: Joi.string().allow('', null),
    bonus_banner_text: Joi.string().allow('', null),
    masterclass_date: Joi.string().allow('', null),
    masterclass_time: Joi.string().allow('', null),
    // Hero copy that used to be hardcoded on the landing page.
    register_before_text: Joi.string().max(200).allow('', null),
    masterclass_label: Joi.string().max(200).allow('', null),
    // Play-icon overlay on the banner thumbnail (only relevant when no video plays inline).
    show_play_icon: Joi.boolean(),
    cta_title: Joi.string().allow('', null),
    cta_subtitle: Joi.string().allow('', null),
    cta_price_text: Joi.string().allow('', null),
    increased_price_text: Joi.string().allow('', null),
    // Campaign pricing: what the inline checkout on this page actually charges
    // (order-service reads sale_price server-side). amount is the struck-through MRP.
    amount: Joi.alternatives().try(Joi.number().min(0), Joi.string().max(20)).allow('', null),
    sale_price: Joi.alternatives().try(Joi.number().min(0), Joi.string().max(20)).allow('', null),
    countdown_minutes: Joi.number().integer().min(1).max(180).allow(null),
    use_global_faq: Joi.boolean(),
    use_course_faq: Joi.boolean(),
    checkout_url: Joi.string().max(1000).allow('', null),
    // Thank-you page destination for buyers who paid through THIS landing page. Empty
    // falls back to whatever the course's own post-purchase tab says; a blank delay
    // means the default countdown.
    post_purchase_redirect_url: Joi.string().max(1000).allow('', null),
    post_purchase_redirect_delay: Joi.alternatives()
        .try(Joi.number().integer().min(0).max(600), Joi.string().max(10))
        .allow('', null),
    stats: Joi.object({
        people_coached: Joi.string().allow('', null),
        preferred_by: Joi.string().allow('', null),
        attended: Joi.string().allow('', null),
    }),
    learning_bullets: Joi.array().items(Joi.string().allow('')),
    feature_cards: Joi.array().items(
        Joi.object({
            icon: Joi.string().allow('', null),
            text: Joi.string().allow('', null),
        }),
    ),
    bonus_items: Joi.array().items(
        Joi.object({
            label: Joi.string().allow('', null),
            icon: Joi.string().allow('', null),
            description: Joi.string().allow('', null),
            worth: Joi.string().allow('', null),
        }),
    ),
    who_can_attend: Joi.array().items(Joi.string().allow('')),
    gallery_images: Joi.array().items(Joi.string().allow('')),
    video_url: Joi.string().max(500).allow('', null),
    text_testimonials: Joi.array().items(
        Joi.object({
            quote: Joi.string().allow('', null),
            name: Joi.string().allow('', null),
            role: Joi.string().allow('', null),
            rating: Joi.number().integer().min(1).max(5).allow(null),
        }),
    ),
    video_testimonials: Joi.array().items(
        Joi.object({
            url: Joi.string().allow('', null),
            thumbnail: Joi.string().allow('', null),
        }),
    ),
    trainer: Joi.object({
        highlights: Joi.array().items(Joi.string().allow('')),
        bio_points: Joi.array().items(Joi.string().allow('')),
        image_url: Joi.string().allow('', null),
    }),
}).unknown(true);

const createMarketingPage = {
    body: Joi.object({
        course_id: Joi.number().integer().positive().required(),
        slug: Joi.string().max(200).allow('', null),
        is_published: Joi.boolean().default(false),
        meta: marketingMetaSchema.allow(null),
    }),
};

const updateMarketingPage = {
    params: idParam.params,
    body: Joi.object({
        course_id: Joi.number().integer().positive(),
        slug: Joi.string().max(200).allow('', null),
        is_published: Joi.boolean(),
        meta: marketingMetaSchema.allow(null),
    }).min(1),
};

// ── Courses ────────────────────────────────────────────────────────

const createCourse = {
    body: Joi.object({
        title: Joi.string().max(500).required(),
        short_title: Joi.string().max(500).allow('', null),
        slug: Joi.string().max(200).allow('', null),
        brief_description: Joi.string().allow('', null),
        description: Joi.string().allow('', null),
        curriculum: Joi.string().allow('', null),
        learn_outcomes: Joi.string().allow('', null),
        requirements: Joi.string().allow('', null),
        terms_conditions: Joi.string().allow('', null),
        price: Joi.number().min(0),
        sale_price: Joi.number().min(0).allow(null),
        thumbnail_url: Joi.string().allow('', null),
        youtube_url: Joi.string().allow('', null),
        enrolled_count: Joi.number().integer().min(0).allow(null),
        ratings: Joi.number().min(0).max(9.99).allow(null),
        rating_users: Joi.number().integer().min(0).allow(null),
        language: Joi.string().allow('', null),
        course_type: Joi.string().max(50).allow('', null),
        taxable: Joi.boolean(),
        keywords: Joi.string().max(500).allow('', null),
        meta_title: Joi.string().max(500).allow('', null),
        meta_description: Joi.string().allow('', null),
        meta_keywords: Joi.string().max(500).allow('', null),
        canonical_url: Joi.string().max(1000).allow('', null),
        robots: Joi.string().max(255).allow('', null),
        og_title: Joi.string().max(255).allow('', null),
        og_description: Joi.string().allow('', null),
        og_image_url: Joi.string().max(500).allow('', null),
        faqs: Joi.string().allow('', null),
        feedback: Joi.string().allow('', null),
        includes_info: Joi.string().allow('', null),
        course_includes: Joi.string().allow('', null),
        certifications: Joi.string().allow('', null),
        gateway: Joi.string().max(200).allow('', null),
        is_published: Joi.boolean().default(false),
        hide_from_public: Joi.boolean().default(false),
        certificate_enabled: Joi.boolean().default(true),
        status: Joi.string().valid('active', 'inactive', 'draft').default('draft'),
        start_date: Joi.date().iso().allow(null),
        end_date: Joi.date().iso().allow(null),
        author_user_id: Joi.number().integer().positive().allow(null),
        author_name: Joi.string().max(255).allow('', null),
        author_role: Joi.string().max(200).allow('', null),
        author_bio: Joi.string().max(5000).allow('', null),
        author_image: Joi.string().max(500).allow('', null),
        course_cat_ids: Joi.array().items(Joi.number().integer().positive()),
        affiliate_commission: Joi.number().min(0).max(100),
        validity: Joi.string().valid('1year', 'lifetime').default('1year'),
        detail_sections: Joi.string().allow('', null),
        post_purchase_links: Joi.string().allow('', null),
        post_purchase_redirect_url: Joi.string().max(1000).allow('', null),
        post_purchase_redirect_delay: Joi.number().integer().min(0).max(600).allow(null),
    }),
};

const updateCourse = {
    params: idParam.params,
    body: Joi.object({
        title: Joi.string().max(500),
        short_title: Joi.string().max(500).allow('', null),
        slug: Joi.string().max(200).allow('', null),
        brief_description: Joi.string().allow('', null),
        description: Joi.string().allow('', null),
        curriculum: Joi.string().allow('', null),
        learn_outcomes: Joi.string().allow('', null),
        requirements: Joi.string().allow('', null),
        terms_conditions: Joi.string().allow('', null),
        price: Joi.number().min(0),
        sale_price: Joi.number().min(0).allow(null),
        thumbnail_url: Joi.string().allow('', null),
        youtube_url: Joi.string().allow('', null),
        enrolled_count: Joi.number().integer().min(0).allow(null),
        ratings: Joi.number().min(0).max(9.99).allow(null),
        rating_users: Joi.number().integer().min(0).allow(null),
        language: Joi.string().allow('', null),
        course_type: Joi.string().max(50).allow('', null),
        taxable: Joi.boolean(),
        keywords: Joi.string().max(500).allow('', null),
        meta_title: Joi.string().max(500).allow('', null),
        meta_description: Joi.string().allow('', null),
        meta_keywords: Joi.string().max(500).allow('', null),
        canonical_url: Joi.string().max(1000).allow('', null),
        robots: Joi.string().max(255).allow('', null),
        og_title: Joi.string().max(255).allow('', null),
        og_description: Joi.string().allow('', null),
        og_image_url: Joi.string().max(500).allow('', null),
        faqs: Joi.string().allow('', null),
        feedback: Joi.string().allow('', null),
        includes_info: Joi.string().allow('', null),
        course_includes: Joi.string().allow('', null),
        certifications: Joi.string().allow('', null),
        gateway: Joi.string().max(200).allow('', null),
        is_published: Joi.boolean(),
        hide_from_public: Joi.boolean(),
        certificate_enabled: Joi.boolean(),
        status: Joi.string().valid('active', 'inactive', 'draft'),
        start_date: Joi.date().iso().allow(null),
        end_date: Joi.date().iso().allow(null),
        author_user_id: Joi.number().integer().positive().allow(null),
        author_name: Joi.string().max(255).allow('', null),
        author_role: Joi.string().max(200).allow('', null),
        author_bio: Joi.string().max(5000).allow('', null),
        author_image: Joi.string().max(500).allow('', null),
        course_cat_ids: Joi.array().items(Joi.number().integer().positive()),
        affiliate_commission: Joi.number().min(0).max(100),
        validity: Joi.string().valid('1year', 'lifetime'),
        detail_sections: Joi.string().allow('', null),
        post_purchase_links: Joi.string().allow('', null),
        post_purchase_redirect_url: Joi.string().max(1000).allow('', null),
        post_purchase_redirect_delay: Joi.number().integer().min(0).max(600).allow(null),
    }),
};

// ── Batches ────────────────────────────────────────────────────────

const createBatch = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(255).allow('', null),
        start_date: Joi.date().iso().allow(null),
        end_date: Joi.date().iso().allow(null),
        meet_link: Joi.string().uri().allow('', null),
    }),
};

const updateBatch = {
    params: idParam.params,
    body: Joi.object({
        name: Joi.string().max(255),
        start_date: Joi.date().iso().allow(null),
        end_date: Joi.date().iso().allow(null),
        meet_link: Joi.string().uri().allow('', null),
    }),
};

// ── Sessions ───────────────────────────────────────────────────────

const createSession = {
    params: idParam.params,
    body: Joi.object({
        title: Joi.string().max(500).required(),
        day_number: Joi.number().integer().min(1),
        scheduled_at: Joi.date().iso().allow(null),
        meet_link: Joi.string().uri().allow('', null),
    }),
};

const updateSession = {
    params: idParam.params,
    body: Joi.object({
        title: Joi.string().max(500),
        day_number: Joi.number().integer().min(1),
        scheduled_at: Joi.date().iso().allow(null),
        meet_link: Joi.string().uri().allow('', null),
    }),
};

// ── Recordings ─────────────────────────────────────────────────────

const addRecording = {
    params: idParam.params,
    body: Joi.object({
        url: Joi.string().max(512).required(),
        source: Joi.string().max(64).allow('', null),
        is_visible: Joi.boolean(),
    }),
};

const recordingIdParam = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
};

const updateRecording = {
    params: recordingIdParam.params,
    body: Joi.object({
        url: Joi.string().max(512).allow(''),
        source: Joi.string().max(255).allow('', null),
        is_visible: Joi.boolean(),
    }).min(1),
};

const toggleVisibility = {
    params: idParam.params,
    body: Joi.object({
        is_visible: Joi.boolean().required(),
    }),
};

const addBatchEnrollment = {
    params: idParam.params,
    body: Joi.object({
        user_id: Joi.number().integer().positive().required(),
    }),
};

const autoEnrollBatch = {
    params: idParam.params,
    body: Joi.object({
        user_id: Joi.number().integer().positive().required(),
        batch_id: Joi.number().integer().positive().allow(null),
    }),
};

const setUserCourseBatch = {
    params: idParam.params,
    body: Joi.object({
        user_id: Joi.number().integer().positive().required(),
        batch_id: Joi.number().integer().positive().required(),
    }),
};

const listBatchesQuery = {
    query: Joi.object({
        course_id: Joi.number().integer().positive().optional(),
        page: Joi.number().integer().min(1).optional(),
        limit: Joi.number().integer().min(1).max(100).optional(),
    }),
};

// ── Materials ──────────────────────────────────────────────────────

const addMaterial = {
    params: idParam.params,
    body: Joi.object({
        title: Joi.string().max(500).required(),
        url: Joi.string().uri().required(),
        type: Joi.string().max(64).allow('', null),
    }),
};

// ── Page Settings ──────────────────────────────────────────────────

const updatePageSetting = {
    params: Joi.object({
        key: Joi.string().max(100).required(),
    }),
    body: Joi.object({
        value: Joi.string().allow('', null),
    }),
};

const courseIdParamCourseReviews = {
    params: Joi.object({
        courseId: Joi.number().integer().positive().required(),
    }),
};

const submitCourseReviewBody = {
    body: Joi.object({
        courseId: Joi.number().integer().positive().required(),
        rating: Joi.number().integer().min(1).max(5).required(),
        body: Joi.string().max(8000).allow('', null),
    }),
};

const listCourseReviewsQuery = {
    query: Joi.object({
        page: Joi.number().integer().min(1).optional(),
        limit: Joi.number().integer().min(1).max(100).optional(),
        course_id: Joi.number().integer().positive().optional(),
    }),
};

const updateCourseReview = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
    body: Joi.object({
        rating: Joi.number().integer().min(1).max(5),
        body: Joi.string().max(8000).allow('', null),
    }).min(1),
};

/** GET /certificates/course/:courseId */
const certificateCourseIdParam = {
    params: Joi.object({
        courseId: Joi.number().integer().positive().required(),
    }),
};

// ── Public certificate download links ──────────────────────────────

/**
 * Deliberately loose: anything that is not a real token should fall through to a 404 from the
 * service, not a 400 from here, so probing a link tells an attacker nothing about the format.
 */
const certificateLinkTokenParam = {
    params: Joi.object({
        token: Joi.string().trim().max(64).required(),
    }),
};

/**
 * POST /certificate-links/:token/claim
 *
 * `company_website` (honeypot) and `rendered_at` (time trap) MUST stay declared here. The shared
 * validate() runs with stripUnknown: true, so an undeclared field is silently removed and the trap
 * would never fire.
 */
const claimCertificateLink = {
    params: Joi.object({
        token: Joi.string().trim().max(64).required(),
    }),
    body: Joi.object({
        name: Joi.string().trim().min(2).max(190).required(),
        email: Joi.string().trim().email({ minDomainSegments: 2, tlds: false }).max(190).required(),
        phone: Joi.string().trim().min(6).max(32).required(),
        company_website: Joi.string().allow('', null),
        rendered_at: Joi.number().integer().min(0),
        utm_source: Joi.string().max(190).allow('', null),
        utm_medium: Joi.string().max(190).allow('', null),
        utm_campaign: Joi.string().max(190).allow('', null),
    }),
};

const retrieveCertificateLink = {
    params: Joi.object({
        token: Joi.string().trim().max(64).required(),
    }),
    body: Joi.object({
        email: Joi.string().trim().email({ minDomainSegments: 2, tlds: false }).max(190).required(),
    }),
};

/** YYYY-MM-DD, kept as a string so a date-only value never shifts across the +05:30 offset. */
const certificateDateOnly = Joi.string()
    .trim()
    .length(10)
    .custom((value, helpers) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!m) return helpers.error('any.invalid');
        const d = new Date(`${value}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? helpers.error('any.invalid') : value;
    }, 'YYYY-MM-DD date')
    .messages({ 'any.invalid': 'certificate_date must be a YYYY-MM-DD date' });

const createCertificateLink = {
    body: Joi.object({
        course_id: Joi.number().integer().positive().required(),
        title: Joi.string().trim().min(2).max(255).required(),
        description: Joi.string().max(5000).allow('', null),
        status: Joi.string().valid('draft', 'active', 'disabled').default('draft'),
        // Required on every link — the client asked for expiry to be mandatory.
        expires_at: Joi.date().iso().required(),
        certificate_date: certificateDateOnly.allow(null, ''),
        max_claims: Joi.number().integer().min(1).allow(null),
        send_email: Joi.boolean(),
        /** Set by admin-service from the signed-in admin, not by the browser. */
        created_by: Joi.number().integer().positive().allow(null),
    }),
};

const updateCertificateLink = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
    body: Joi.object({
        course_id: Joi.number().integer().positive(),
        title: Joi.string().trim().min(2).max(255),
        description: Joi.string().max(5000).allow('', null),
        status: Joi.string().valid('draft', 'active', 'disabled'),
        expires_at: Joi.date().iso(),
        certificate_date: certificateDateOnly.allow(null, ''),
        max_claims: Joi.number().integer().min(1).allow(null),
        send_email: Joi.boolean(),
    }).min(1),
};

const listCertificateLinksQuery = {
    query: Joi.object({
        page: Joi.number().integer().min(1),
        limit: Joi.number().integer().min(1).max(100),
        search: Joi.string().trim().max(200).allow(''),
        status: Joi.string().valid('draft', 'active', 'disabled'),
        course_id: Joi.number().integer().positive(),
        sortBy: Joi.string().valid('created_at', 'updated_at', 'title', 'expires_at', 'claims_count'),
        sortOrder: Joi.string().valid('ASC', 'DESC', 'asc', 'desc'),
    }),
};

/** Limit goes to 500 so the admin CSV export can page in larger batches. */
const listCertificateLinkClaimsQuery = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
    query: Joi.object({
        page: Joi.number().integer().min(1),
        limit: Joi.number().integer().min(1).max(500),
        search: Joi.string().trim().max(200).allow(''),
    }),
};

module.exports = {
    idParam,
    slugParam,
    createMarketingPage,
    updateMarketingPage,
    certificateCourseIdParam,
    certificateLinkTokenParam,
    claimCertificateLink,
    retrieveCertificateLink,
    createCertificateLink,
    updateCertificateLink,
    listCertificateLinksQuery,
    listCertificateLinkClaimsQuery,
    courseIdParamCourseReviews,
    submitCourseReviewBody,
    listCourseReviewsQuery,
    updateCourseReview,
    createCourse,
    updateCourse,
    createBatch,
    updateBatch,
    createSession,
    updateSession,
    addRecording,
    updateRecording,
    toggleVisibility,
    addBatchEnrollment,
    autoEnrollBatch,
    setUserCourseBatch,
    listBatchesQuery,
    addMaterial,
    updatePageSetting,
};
