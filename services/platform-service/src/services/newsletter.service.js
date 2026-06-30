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

function buildWelcomeEmail(email, unsubscribeToken) {
  const unsubUrl = mailer.buildUnsubscribeUrl(unsubscribeToken);
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to Study Cafe Newsletter</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#1e3a5f;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:0.5px;">Study Cafe</h1>
              <p style="margin:6px 0 0;color:#93c5fd;font-size:14px;">Your Learning Companion</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 24px;">
              <h2 style="margin:0 0 16px;color:#1e3a5f;font-size:22px;">Thank You for Subscribing!</h2>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                Hi there,<br /><br />
                Welcome to the <strong>Study Cafe</strong> newsletter! We're thrilled to have you with us.
              </p>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                You'll now receive the latest updates on:
              </p>
              <ul style="margin:0 0 24px;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
                <li>New courses &amp; study materials</li>
                <li>Legal articles &amp; case law updates</li>
                <li>Exclusive offers &amp; membership plans</li>
                <li>Tips to boost your exam preparation</li>
              </ul>
              <p style="margin:0 0 32px;color:#374151;font-size:15px;line-height:1.6;">
                Stay tuned - great content is coming your way!
              </p>
              <div style="text-align:center;">
                <a href="https://studycafe.in" style="display:inline-block;background-color:#1e3a5f;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600;">
                  Visit Study Cafe
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.6;">
                You received this email because you subscribed to the Study Cafe newsletter.<br />
                <a href="${unsubUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return html;
}

async function subscribe(email) {
  const normalized = String(email).trim().toLowerCase();
  const existing = await NewsletterSubscriber.findOne({ where: { email: normalized } });
  if (existing) {
    return { already_subscribed: true };
  }
  const token = randomToken();
  await NewsletterSubscriber.create({
    email: normalized,
    is_verified: true,
    unsubscribe_token: token,
  });

  // Send welcome email (fire-and-forget — don't fail the subscription if mail fails)
  logger.info(`[newsletter] welcome email trigger for ${normalized}`);
  mailer.sendMail({
    to: normalized,
    subject: 'Welcome to Study Cafe Newsletter!',
    html: buildWelcomeEmail(normalized, token),
  }).then((result) => {
    if (result && result.ok) {
      logger.info(`[newsletter] welcome email sent for ${normalized}`);
      return;
    }
    logger.error(`[newsletter] welcome email failed for ${normalized}: ${(result && result.error) || 'unknown error'}`);
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

// ── Sync membership members ──────────────────────────────────────────

async function syncMembershipSubscribers(planSlugs) {
  const { QueryTypes } = require('sequelize');
  const { sequelize } = require('../models');

  // Build a WHERE clause for the requested plan slugs
  const slugPlaceholders = planSlugs.map(() => '?').join(', ');
  const now = new Date();

  logger.info(`[newsletter] sync-members start: plans=${JSON.stringify(planSlugs)} slugPlaceholders=${slugPlaceholders}`);

  let rows;
  try {
    rows = await sequelize.query(
      `SELECT DISTINCT u.email
       FROM user_memberships um
       JOIN users u ON u.id = um.user_id
       WHERE um.membership_type IN (${slugPlaceholders})
         AND um.expires_at > ?
         AND u.email IS NOT NULL
         AND u.email != ''`,
      { replacements: [...planSlugs, now], type: QueryTypes.SELECT }
    );
    logger.info(`[newsletter] sync-members query returned ${rows.length} rows`);
  } catch (err) {
    logger.error(`[newsletter] sync-members SQL error: ${err.message}`, { stack: err.stack, sql: err.sql });
    throw err;
  }

  const emails = Array.isArray(rows) ? rows.map((r) => r.email).filter(Boolean) : [];

  if (emails.length === 0) {
    return { synced_count: 0, already_subscribed_count: 0 };
  }

  const normalizedEmails = [...new Set(emails.map((e) => String(e).trim().toLowerCase()))];

  // Fetch all already-subscribed emails in one query
  const existing = await NewsletterSubscriber.findAll({
    where: { email: { [Op.in]: normalizedEmails } },
    attributes: ['email'],
  });
  const existingSet = new Set(existing.map((r) => r.email));

  const toInsert = normalizedEmails
    .filter((e) => !existingSet.has(e))
    .map((e) => ({ email: e, is_verified: true, unsubscribe_token: randomToken() }));

  if (toInsert.length > 0) {
    await NewsletterSubscriber.bulkCreate(toInsert, { ignoreDuplicates: true });
  }

  const syncedCount = toInsert.length;
  const alreadyCount = normalizedEmails.length - syncedCount;

  logger.info(`[newsletter] sync-members: synced=${syncedCount} already=${alreadyCount} plans=${planSlugs.join(',')}`);
  return { synced_count: syncedCount, already_subscribed_count: alreadyCount };
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
  syncMembershipSubscribers,
};
