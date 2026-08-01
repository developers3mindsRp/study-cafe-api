const Joi = require('joi');

// ── Auth ────────────────────────────────────────────────────────────

// E.164 (react-phone-number-input) — + and up to 15 digits after country code
const e164Phone = Joi.string()
    .pattern(/^\+[1-9]\d{1,14}$/)
    .message('phone must be a valid international number (E.164)');

const register = {
    body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(128).required(),
        name: Joi.string().trim().min(1).max(255).required(),
        phone: e164Phone.required(),
        profession: Joi.string().trim().min(1).max(200).required(),
        company: Joi.string().trim().max(200).allow('', null),
        designation: Joi.string().trim().max(200).allow('', null),
        city: Joi.string().trim().min(1).max(100).required(),
        state: Joi.string().trim().min(1).max(100).required(),
        country: Joi.string().trim().max(100).allow('', null),
        referralCode: Joi.string().max(32).allow('', null),
    }),
};

/**
 * Checkout signup (/signup) — identity + credential only.
 * Profession / city / state are collected later via PATCH /user/profile so a
 * course link does not put a 10-field form between the buyer and the payment.
 */
const registerQuick = {
    body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(128).required(),
        confirmPassword: Joi.string().max(128).allow('', null),
        name: Joi.string().trim().min(1).max(255).required(),
        phone: e164Phone.required(),
        referralCode: Joi.string().max(32).allow('', null),
    }),
};

const login = {
    body: Joi.object({
        // Email, WP username (login), or legacy numeric Studycafe / wp_user_id
        email: Joi.string().trim().min(1).max(255).required(),
        password: Joi.string().required(),
    }),
};

const loginOtpRequest = {
    body: Joi.object({
        email: Joi.string().email().required(),
    }),
};

const loginOtp = {
    body: Joi.object({
        email: Joi.string().email().required(),
        otp: Joi.string().pattern(/^\d{6}$/).required(),
    }),
};

const verifyEmailOtp = {
    body: Joi.object({
        otp: Joi.string().pattern(/^\d{6}$/).required(),
    }),
};

const refreshToken = {
    body: Joi.object({
        refreshToken: Joi.string().required(),
    }),
};

const changePassword = {
    body: Joi.object({
        currentPassword: Joi.string().required(),
        newPassword: Joi.string().min(6).max(128).required(),
        confirmPassword: Joi.string().max(128).allow('', null),
    }),
};

const forgotPassword = {
    body: Joi.object({
        email: Joi.string().email().required(),
    }),
};

const resetPassword = {
    body: Joi.object({
        token: Joi.string().min(16).required(),
        password: Joi.string().min(6).max(128).required(),
    }),
};

// ── Access ──────────────────────────────────────────────────────────

const checkAccess = {
    query: Joi.object({
        courseId: Joi.number().integer().positive().required(),
    }),
};

const grantCourse = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
        courseId: Joi.number().integer().positive().required(),
        orderId: Joi.string().allow('', null),
        expiresAt: Joi.date().iso().allow(null),
    }),
};

const grantMembership = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
        membershipType: Joi.string().required(),
        orderId: Joi.string().allow('', null),
        startsAt: Joi.date().iso().required(),
        expiresAt: Joi.date().iso().greater(Joi.ref('startsAt')).required(),
        planJson: Joi.object({
            price: Joi.string().allow('', null),
            plan_validity: Joi.string().allow('', null),
            plan_purchased: Joi.string().allow('', null),
            plan_expiry: Joi.string().allow('', null),
            payment_id: Joi.string().allow('', null),
        }).allow(null),
    }),
};

// ── Admin Users ─────────────────────────────────────────────────────

const createAdminUser = {
    body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(128).allow('', null).optional(),
        name: Joi.string().max(255).allow('', null),
        role_id: Joi.number().integer().positive().required(),
        permission_overrides: Joi.array().items(Joi.string()).default([]),
    }),
};

const lookupAdminUser = {
    query: Joi.object({
        email: Joi.string().email().required(),
    }),
};

const updateAdminUser = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
    body: Joi.object({
        name: Joi.string().max(255).allow('', null),
        role_id: Joi.number().integer().positive(),
        is_active: Joi.boolean(),
        password: Joi.string().min(6).max(128),
        permission_overrides: Joi.array().items(Joi.string()),
    }),
};

const createRole = {
    body: Joi.object({
        name: Joi.string().trim().min(2).max(64).required(),
        description: Joi.string().max(255).allow('', null),
        permissions: Joi.array().items(Joi.string()).default([]),
        is_admin_panel: Joi.boolean().default(true),
    }),
};

const updateRole = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
    body: Joi.object({
        name: Joi.string().trim().min(2).max(64),
        description: Joi.string().max(255).allow('', null),
        permissions: Joi.array().items(Joi.string()),
        is_admin_panel: Joi.boolean(),
    }).min(1),
};

const idParam = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
};

const revokeCourse = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
        courseId: Joi.number().integer().positive().required(),
        orderId: Joi.string().allow('', null),
    }),
};

const revokeMembership = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
        orderId: Joi.string().required(),
    }),
};

const removeMembership = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
    }),
};

module.exports = {
    register,
    registerQuick,
    login,
    loginOtpRequest,
    loginOtp,
    verifyEmailOtp,
    refreshToken,
    changePassword,
    forgotPassword,
    resetPassword,
    checkAccess,
    grantCourse,
    revokeCourse,
    grantMembership,
    revokeMembership,
    removeMembership,
    createAdminUser,
    lookupAdminUser,
    updateAdminUser,
    createRole,
    updateRole,
    idParam,
};
