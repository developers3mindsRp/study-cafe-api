const newsletterService = require('../services/newsletter.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent } = require('../../../../shared');

// ── Public ─────────────────────────────────────────────────────────

const subscribe = asyncHandler(async (req, res) => {
  const result = await newsletterService.subscribe(req.body.email);
  sendSuccess(res, { subscribed: true, ...result });
});

const unsubscribe = asyncHandler(async (req, res) => {
  const ok = await newsletterService.unsubscribeByToken(req.query.token);
  if (!ok) throw new AppError('Invalid or expired unsubscribe link', 400);
  sendSuccess(res, { unsubscribed: true });
});

// ── Admin: Subscribers ─────────────────────────────────────────────

const listSubscribers = asyncHandler(async (req, res) => {
  const data = await newsletterService.listSubscribers();
  sendSuccess(res, data);
});

const deleteSubscriber = asyncHandler(async (req, res) => {
  const ok = await newsletterService.deleteSubscriber(req.params.id);
  if (!ok) throw new AppError('Subscriber not found', 404);
  sendNoContent(res);
});

// ── Admin: Templates ───────────────────────────────────────────────

const listTemplates = asyncHandler(async (req, res) => {
  const data = await newsletterService.listTemplates();
  sendSuccess(res, data);
});

const createTemplate = asyncHandler(async (req, res) => {
  const data = await newsletterService.createTemplate(req.body);
  sendCreated(res, data);
});

const updateTemplate = asyncHandler(async (req, res) => {
  const data = await newsletterService.updateTemplate(req.params.id, req.body);
  if (!data) throw new AppError('Template not found', 404);
  sendSuccess(res, data);
});

const deleteTemplate = asyncHandler(async (req, res) => {
  const ok = await newsletterService.deleteTemplate(req.params.id);
  if (!ok) throw new AppError('Template not found', 404);
  sendNoContent(res);
});

// ── Admin: Send ────────────────────────────────────────────────────

const sendNewsletter = asyncHandler(async (req, res) => {
  const data = await newsletterService.sendNewsletter(req.body);
  sendSuccess(res, data);
});

// ── Admin: Sync membership members ────────────────────────────────

const syncMembershipSubscribers = asyncHandler(async (req, res) => {
  const { plan_slugs } = req.body;
  if (!Array.isArray(plan_slugs) || plan_slugs.length === 0) {
    throw new AppError('plan_slugs must be a non-empty array', 400);
  }
  const data = await newsletterService.syncMembershipSubscribers(plan_slugs);
  sendSuccess(res, data);
});

module.exports = {
  subscribe,
  unsubscribe,
  listSubscribers,
  deleteSubscriber,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  sendNewsletter,
  syncMembershipSubscribers,
};
