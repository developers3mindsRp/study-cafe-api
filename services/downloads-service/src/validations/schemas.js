const Joi = require('joi');

const idParam = {
  params: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
};

const listFilesQuery = {
  query: Joi.object({
    page: Joi.number().integer().positive().default(1),
    limit: Joi.number().integer().positive().max(100).default(10),
    search: Joi.string().allow('', null),
    category: Joi.alternatives().try(
      Joi.number().integer().positive(),
      Joi.string().min(1)
    ).allow('', null),
    sort: Joi.string().valid('latest', 'trending').default('latest'),
  }),
};

const createFile = {
  body: Joi.object({
    title: Joi.string().max(500).required(),
    slug: Joi.string().max(200).allow('', null),
    file_url: Joi.string().uri().max(500).required(),
    author_id: Joi.number().integer().positive().allow(null),
    category_ids: Joi.array().items(Joi.number().integer().positive()).default([]),
    status: Joi.string().valid('publish', 'draft', 'private').default('publish'),
    meta_title: Joi.string().allow('', null),
    meta_description: Joi.string().allow('', null),
    meta_keywords: Joi.string().allow('', null),
  }),
};

const updateFile = {
  params: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
  body: Joi.object({
    title: Joi.string().max(500),
    slug: Joi.string().max(200).allow('', null),
    file_url: Joi.string().uri().max(500),
    author_id: Joi.number().integer().positive().allow(null),
    category_ids: Joi.array().items(Joi.number().integer().positive()),
    status: Joi.string().valid('publish', 'draft', 'private'),
    meta_title: Joi.string().allow('', null),
    meta_description: Joi.string().allow('', null),
    meta_keywords: Joi.string().allow('', null),
  }),
};

const createCategory = {
  body: Joi.object({
    name: Joi.string().max(200).required(),
    slug: Joi.string().max(200).allow('', null),
    wp_term_id: Joi.number().integer().positive().allow(null),
  }),
};

const updateCategory = {
  params: Joi.object({
    id: Joi.number().integer().positive().required(),
  }),
  body: Joi.object({
    name: Joi.string().max(200),
    slug: Joi.string().max(200).allow('', null),
    wp_term_id: Joi.number().integer().positive().allow(null),
  }),
};

const slugParam = {
  params: Joi.object({
    slug: Joi.string().required(),
  }),
};

const categoryFilesQuery = {
  params: Joi.object({
    slug: Joi.string().required(),
  }),
  query: Joi.object({
    page: Joi.number().integer().positive().default(1),
    limit: Joi.number().integer().positive().max(100).default(10),
  }),
};

module.exports = {
  idParam,
  listFilesQuery,
  createFile,
  updateFile,
  createCategory,
  updateCategory,
  slugParam,
  categoryFilesQuery,
};
