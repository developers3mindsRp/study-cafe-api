const crypto = require('crypto');
const { Op } = require('sequelize');
const { NewsletterSubscriber, NewsletterTemplate } = require('../models');
const mailer = require('./mailer.service');
const { AppError, logger } = require('../../../../shared');

const BATCH_SIZE = 50;

function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

// ── Subscribers ──────────────────────────────────────────────────────

async function subscribe(email) {
  const normalized = String(email).trim().toLowerCase();
  const existing = await NewsletterSubscriber.findOne({ where: { email: normalized } });
  if (existing) {
    return { already_subscribed: true };
  }
  await NewsletterSubscriber.create({
    email: normalized,
    is_verified: true,
    unsubscribe_token: randomToken(),
  });
  return { already_subscribed: false };
}

async function unsubscribeByToken(token) {
  const row = await NewsletterSubscriber.findOne({ where: { unsubscribe_token: token } });
  if (!row) return false;
  await row.destroy();
  return true;
}

async function listSubscribers() {
  const rows = await NewsletterSubscriber.findAll({ order: [['created_at', 'DESC']] });
  return rows.map((r) => r.get({ plain: true }));
}

async function deleteSubscriber(id) {
  const row = await NewsletterSubscriber.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

// ── Templates ────────────────────────────────────────────────────────

async function listTemplates() {
  const rows = await NewsletterTemplate.findAll({ order: [['created_at', 'DESC']] });
  return rows.map((r) => r.get({ plain: true }));
}

async function createTemplate(data) {
  const row = await NewsletterTemplate.create(data);
  return row.get({ plain: true });
}

async function updateTemplate(id, data) {
  const row = await NewsletterTemplate.findByPk(id);
  if (!row) return null;
  await row.update(data);
  return row.get({ plain: true });
}

async function deleteTemplate(id) {
  const row = await NewsletterTemplate.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

// ── Send ─────────────────────────────────────────────────────────────

async function sendNewsletter({ template_id, custom_subject, custom_content, send_to }) {
  const template = await NewsletterTemplate.findByPk(template_id);
  if (!template) throw new AppError('Template not found', 404);

  const subject = (custom_subject && custom_subject.trim()) || template.subject;
  const baseHtml = (custom_content && custom_content.trim()) || template.html_content;

  let recipients;
  if (send_to === 'all' || send_to === undefined) {
    const rows = await NewsletterSubscriber.findAll({ where: { is_verified: true } });
    recipients = rows.map((r) => ({ email: r.email, unsubscribe_token: r.unsubscribe_token }));
  } else {
    const rows = await NewsletterSubscriber.findAll({
      where: { email: { [Op.in]: send_to.map((e) => String(e).toLowerCase()) } },
    });
    recipients = rows.map((r) => ({ email: r.email, unsubscribe_token: r.unsubscribe_token }));
  }

  if (recipients.length === 0) {
    return { recipients_count: 0, sent_count: 0, failed_count: 0 };
  }

  let sent = 0;
  let failed = 0;

  // Process in batches with Promise.allSettled so one bad address
  // doesn't abort the rest, and we don't flood the SMTP server.
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((r) => {
        const unsubUrl = mailer.buildUnsubscribeUrl(r.unsubscribe_token);
        const html = baseHtml + mailer.renderUnsubscribeFooter(unsubUrl);
        return mailer.sendMail({ to: r.email, subject, html });
      }),
    );
    for (const res of results) {
      if (res.status === 'fulfilled' && res.value && res.value.ok) sent += 1;
      else failed += 1;
    }
  }

  logger.info(`[newsletter] sent=${sent} failed=${failed} total=${recipients.length}`);
  return { recipients_count: recipients.length, sent_count: sent, failed_count: failed };
}

module.exports = {
  subscribe,
  unsubscribeByToken,
  listSubscribers,
  deleteSubscriber,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  sendNewsletter,
};
