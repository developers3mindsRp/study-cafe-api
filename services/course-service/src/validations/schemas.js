const Joi = require('joi');

// ── Param schemas ──────────────────────────────────────────────────

const idParam = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
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
        language: Joi.string().allow('', null),
        course_type: Joi.string().max(50).allow('', null),
        taxable: Joi.boolean(),
        keywords: Joi.string().max(500).allow('', null),
        faqs: Joi.string().allow('', null),
        feedback: Joi.string().allow('', null),
        includes_info: Joi.string().allow('', null),
        course_includes: Joi.string().allow('', null),
        certifications: Joi.string().allow('', null),
        gateway: Joi.string().max(200).allow('', null),
        is_published: Joi.boolean().default(false),
        status: Joi.string().valid('active', 'inactive', 'draft').default('draft'),
        start_date: Joi.date().iso().allow(null),
        end_date: Joi.date().iso().allow(null),
        author_user_id: Joi.number().integer().positive().allow(null),
        author_name: Joi.string().max(255).allow('', null),
        author_role: Joi.string().max(200).allow('', null),
        author_bio: Joi.string().max(200).allow('', null),
        author_image: Joi.string().max(500).allow('', null),
        course_cat_ids: Joi.array().items(Joi.number().integer().positive()),
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
        language: Joi.string().allow('', null),
        course_type: Joi.string().max(50).allow('', null),
        taxable: Joi.boolean(),
        keywords: Joi.string().max(500).allow('', null),
        faqs: Joi.string().allow('', null),
        feedback: Joi.string().allow('', null),
        includes_info: Joi.string().allow('', null),
        course_includes: Joi.string().allow('', null),
        certifications: Joi.string().allow('', null),
        gateway: Joi.string().max(200).allow('', null),
        is_published: Joi.boolean(),
        status: Joi.string().valid('active', 'inactive', 'draft'),
        start_date: Joi.date().iso().allow(null),
        end_date: Joi.date().iso().allow(null),
        author_user_id: Joi.number().integer().positive().allow(null),
        author_name: Joi.string().max(255).allow('', null),
        author_role: Joi.string().max(200).allow('', null),
        author_bio: Joi.string().max(200).allow('', null),
        author_image: Joi.string().max(500).allow('', null),
        course_cat_ids: Joi.array().items(Joi.number().integer().positive()),
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

const listBatchesQuery = {
    query: Joi.object({
        course_id: Joi.number().integer().positive().optional(),
        page: Joi.number().integer().min(1).optional(),
        limit: Joi.number().integer().min(1).max(50).optional(),
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

module.exports = {
    idParam,
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
    listBatchesQuery,
    addMaterial,
    updatePageSetting,
};
