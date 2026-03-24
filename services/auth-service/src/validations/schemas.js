const Joi = require('joi');

// ── Auth ────────────────────────────────────────────────────────────

const register = {
    body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(128).required(),
        name: Joi.string().max(255).allow('', null),
    }),
};

const login = {
    body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required(),
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
    }),
};

const grantMembership = {
    body: Joi.object({
        userId: Joi.number().integer().positive().required(),
        membershipType: Joi.string().required(),
        orderId: Joi.string().allow('', null),
        startsAt: Joi.date().iso().required(),
        expiresAt: Joi.date().iso().greater(Joi.ref('startsAt')).required(),
    }),
};

// ── Admin Users ─────────────────────────────────────────────────────

const createAdminUser = {
    body: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().min(6).max(128).required(),
        name: Joi.string().max(255).allow('', null),
        role_id: Joi.number().integer().positive().required(),
        permission_overrides: Joi.array().items(Joi.string()).default([]),
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

const idParam = {
    params: Joi.object({
        id: Joi.number().integer().positive().required(),
    }),
};

module.exports = {
    register,
    login,
    refreshToken,
    changePassword,
    checkAccess,
    grantCourse,
    grantMembership,
    createAdminUser,
    updateAdminUser,
    idParam,
};
