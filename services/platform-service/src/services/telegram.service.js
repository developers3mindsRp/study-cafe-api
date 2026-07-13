/**
 * Telegram Publishing Service
 * ═══════════════════════════
 *
 * Automatically posts an article to a Telegram group/channel the moment it
 * becomes published. It is wired into EVERY publish path:
 *
 *   • createArticle (immediate publish)          — platform.service.js
 *   • updateArticle (draft/scheduled → publish)  — platform.service.js
 *   • atomicPublishArticle (scheduled fires)     — article-scheduling.service.js
 *        └─ covers the BullMQ worker, the in-process poller and startup reconcile
 *
 * EXACTLY-ONCE DELIVERY
 * ─────────────────────
 * An article can reach "publish" through several concurrent paths (worker,
 * poller, reconcile, multiple API replicas, plus later edits that re-save a
 * published row). To guarantee the group is notified exactly once we use the
 * same atomic-claim pattern the scheduler already relies on:
 *
 *   UPDATE articles SET telegram_posted_at = NOW()
 *   WHERE id = :id AND status = 'publish' AND telegram_posted_at IS NULL
 *
 * Only the first caller flips the row (affected rows = 1) and owns the post;
 * every other caller sees affected rows = 0 and silently skips. If the actual
 * Telegram API call then fails we clear the claim again so a later retry or
 * re-publish can post it. `force: true` bypasses the claim for manual testing.
 *
 * FAILURE ISOLATION
 * ─────────────────
 * Publishing an article must never fail because Telegram is down. The notify
 * helper never throws — it logs and returns a result object, exactly like
 * mailer.service.js. Callers fire it and forget.
 *
 * CONFIG (see config/index.js → telegram)
 * ───────────────────────────────────────
 *   TELEGRAM_BOT_TOKEN        bot token from @BotFather (format "<id>:<hash>")
 *   TELEGRAM_CHAT_ID          target group/channel id (e.g. -1001073960020)
 *   TELEGRAM_PUBLISH_ENABLED  "true" (default) | "false" to disable posting
 *   TELEGRAM_API_BASE_URL     override for tests (default https://api.telegram.org)
 */

const { QueryTypes } = require('sequelize');
const config = require('../config');
const { logger } = require('../../../../shared');
const { stripHtmlToPlain } = require('../../../../shared/seoMetaDescription');
const { sequelize } = require('../models');

/** Telegram caption limit is 1024 chars; keep body well under it. */
const SNIPPET_MAX_LEN = 400;
/** Network timeout for a single Telegram API call. */
const REQUEST_TIMEOUT_MS = 15_000;

// ─── Config helpers ──────────────────────────────────────────────────────────

/** True only when posting is enabled AND both credentials are present. */
function isConfigured() {
  const { enabled, botToken, chatId } = config.telegram;
  return Boolean(enabled && botToken && chatId);
}

function apiUrl(method) {
  return `${config.telegram.apiBaseUrl}/bot${config.telegram.botToken}/${method}`;
}

// ─── Message building ────────────────────────────────────────────────────────

/** Escape the five characters Telegram's HTML parse mode treats as markup. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Absolute public URL of the article, in the legacy WordPress permalink form
 * `<base>/<slug>-<id>.html` (matches the existing Telegram channel style).
 */
function articleUrl(article) {
  const base = config.telegram.articleBaseUrl;
  if (!base || !article.slug || !article.id) return null;
  return `${base}/${article.slug}-${article.id}.html`;
}

/** Short plain-text teaser from excerpt → sub_heading → body, HTML stripped. */
function buildSnippet(article) {
  const source = article.excerpt || article.sub_heading || article.content || '';
  const plain = stripHtmlToPlain(source);
  if (!plain) return '';
  return plain.length > SNIPPET_MAX_LEN ? `${plain.slice(0, SNIPPET_MAX_LEN).trimEnd()}…` : plain;
}

/** True when the thumbnail is a public absolute URL Telegram can fetch. */
function isFetchableImage(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/**
 * Compose the HTML caption/text sent to the group.
 * Uses Telegram's HTML parse mode: only <b>/<a> are emitted, everything
 * interpolated is escaped.
 */
function buildMessageHtml(article) {
  const lines = [];
  const title = String(article.title || '').trim();
  if (title) lines.push(`📢 <b>${escapeHtml(title)}</b>`);

  const snippet = buildSnippet(article);
  if (snippet) lines.push('', escapeHtml(snippet));

  const url = articleUrl(article);
  if (url) lines.push('', `🔗 <a href="${escapeHtml(url)}">Read the full article</a>`);

  return lines.join('\n').trim();
}

// ─── Telegram API calls ──────────────────────────────────────────────────────

/**
 * POST a JSON payload to a Telegram Bot API method.
 * Never throws — returns { ok, result?, error? }.
 */
async function callTelegram(method, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(apiUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      return {
        ok: false,
        error: `${method} failed: HTTP ${res.status} ${body.description || res.statusText || ''}`.trim(),
      };
    }
    return { ok: true, result: body.result };
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : err.message;
    return { ok: false, error: `${method} request error: ${reason}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send the article to the configured chat. Prefers a rich photo post when the
 * thumbnail is a fetchable URL, and falls back to a plain text post when there
 * is no image or Telegram refuses the photo (e.g. unreachable localhost URL).
 *
 * @returns {Promise<{ ok: boolean, messageId?: number, error?: string }>}
 */
async function sendArticleMessage(article) {
  const html = buildMessageHtml(article);
  if (!html) return { ok: false, error: 'nothing to post (article has no title/content)' };

  const chatId = config.telegram.chatId;

  if (isFetchableImage(article.thumbnail_url)) {
    const photo = await callTelegram('sendPhoto', {
      chat_id: chatId,
      photo: article.thumbnail_url.trim(),
      caption: html,
      parse_mode: 'HTML',
    });
    if (photo.ok) return { ok: true, messageId: photo.result?.message_id };
    logger.warn('[telegram] sendPhoto failed — falling back to text', {
      articleId: article.id,
      error: photo.error,
    });
  }

  const text = await callTelegram('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
  });
  if (text.ok) return { ok: true, messageId: text.result?.message_id };
  return { ok: false, error: text.error };
}

// ─── DB claim (exactly-once) ─────────────────────────────────────────────────

/**
 * Atomically claim the right to post this article. Returns true only for the
 * single caller that flips telegram_posted_at from NULL while the row is
 * published. All other callers get false and must skip.
 */
async function claimTelegramPost(articleId) {
  const [, meta] = await sequelize.query(
    `UPDATE articles
        SET telegram_posted_at = NOW()
      WHERE id = :id
        AND status = 'publish'
        AND deleted_at IS NULL
        AND telegram_posted_at IS NULL`,
    { replacements: { id: articleId }, type: QueryTypes.UPDATE },
  );
  const affected = typeof meta === 'number' ? meta : (meta?.affectedRows ?? 0);
  return affected > 0;
}

/** Release a previously-taken claim so a retry/re-publish can post again. */
async function releaseTelegramClaim(articleId) {
  await sequelize.query(
    `UPDATE articles SET telegram_posted_at = NULL WHERE id = :id`,
    { replacements: { id: articleId }, type: QueryTypes.UPDATE },
  );
}

/** Record the Telegram message id for observability (best-effort). */
async function recordTelegramMessageId(articleId, messageId) {
  if (!messageId) return;
  await sequelize
    .query(`UPDATE articles SET telegram_message_id = :mid WHERE id = :id`, {
      replacements: { id: articleId, mid: messageId },
      type: QueryTypes.UPDATE,
    })
    .catch((err) => logger.warn('[telegram] could not store message id', { articleId, error: err.message }));
}

/** Load the minimal columns needed to build the post. */
async function loadArticleForPost(articleId) {
  const rows = await sequelize.query(
    `SELECT id, title, slug, excerpt, sub_heading, content, thumbnail_url, status
       FROM articles
      WHERE id = :id AND deleted_at IS NULL
      LIMIT 1`,
    { replacements: { id: articleId }, type: QueryTypes.SELECT },
  );
  return rows[0] || null;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Notify the Telegram group that an article was published. Safe to call from
 * any publish path, concurrently, and repeatedly — the atomic claim guarantees
 * exactly one post per article. Never throws.
 *
 * @param {number} articleId
 * @param {{ force?: boolean }} [opts]  force=true bypasses the once-only claim (manual re-send)
 * @returns {Promise<{ ok: boolean, skipped?: string, messageId?: number, error?: string }>}
 */
async function notifyArticlePublished(articleId, opts = {}) {
  const force = Boolean(opts.force);

  if (!config.telegram.enabled) return { ok: false, skipped: 'disabled' };
  if (!isConfigured()) {
    logger.warn('[telegram] not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID', { articleId });
    return { ok: false, skipped: 'not_configured' };
  }

  const article = await loadArticleForPost(articleId);
  if (!article) return { ok: false, skipped: 'not_found' };
  if (String(article.status).toLowerCase() !== 'publish') return { ok: false, skipped: 'not_published' };

  // Claim exactly-once unless forcing a manual re-send.
  if (!force) {
    const claimed = await claimTelegramPost(articleId).catch((err) => {
      logger.error('[telegram] claim query failed', { articleId, error: err.message });
      return false;
    });
    if (!claimed) return { ok: false, skipped: 'already_posted' };
  }

  logger.info('[telegram] posting article to group', { articleId, chatId: config.telegram.chatId, force });
  const sent = await sendArticleMessage(article);

  if (!sent.ok) {
    logger.error('[telegram] post failed', { articleId, error: sent.error });
    // Only release a claim we just took — a forced re-send must not wipe the
    // original successful-post marker.
    if (!force) await releaseTelegramClaim(articleId).catch(() => {});
    return { ok: false, error: sent.error };
  }

  await recordTelegramMessageId(articleId, sent.messageId);
  logger.info('[telegram] article posted', { articleId, messageId: sent.messageId });
  return { ok: true, messageId: sent.messageId };
}

/**
 * Send an ad-hoc plain-text message to the configured chat. Used by the CLI
 * connectivity test (scripts/test-telegram.js). Never throws.
 */
async function sendTestMessage(text) {
  if (!isConfigured()) return { ok: false, error: 'Telegram not configured (token/chat id missing or disabled)' };
  const res = await callTelegram('sendMessage', {
    chat_id: config.telegram.chatId,
    text: text || '✅ Study Cafe → Telegram integration test message.',
    parse_mode: 'HTML',
  });
  return res.ok ? { ok: true, messageId: res.result?.message_id } : res;
}

module.exports = {
  notifyArticlePublished,
  sendTestMessage,
  isConfigured,
  // exported for unit-testing / manual inspection
  buildMessageHtml,
  articleUrl,
  buildSnippet,
};
