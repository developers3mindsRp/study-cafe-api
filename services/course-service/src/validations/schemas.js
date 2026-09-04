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

module.exports = {
    idParam,
    slugParam,
    createMarketingPage,
    updateMarketingPage,
    certificateCourseIdParam,
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
