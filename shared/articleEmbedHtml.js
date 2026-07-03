'use strict';

/**
 * Server-side mirror of admin-panel `embedHtml.ts` + `socialEmbeds.ts`.
 * ArticleContentRenderer: expandEmbedMarkersInHtml → ArticleHtmlBlock → hydrateSocialEmbeds.
 */

const EMBED_MARKER_RE =
  /<div[^>]*\bdata-article-embed-b64="([^"]*)"[^>]*>\s*<\/div>/gi;

const TWITTER_WIDGETS_SRC = 'https://platform.twitter.com/widgets.js';
const INSTAGRAM_EMBED_SRC = 'https://www.instagram.com/embed.js';

/** Match admin `decodeEmbedHtml` (btoa(unescape(encodeURIComponent(html)))). */
function decodeEmbedHtml(encoded) {
  try {
    const buf = Buffer.from(String(encoded || ''), 'base64');
    let escaped = '';
    for (let i = 0; i < buf.length; i++) {
      escaped += `%${buf[i].toString(16).padStart(2, '0')}`;
    }
    return decodeURIComponent(escaped);
  } catch {
    return '';
  }
}

/** Same as admin `expandEmbedMarkersInHtml`. */
function expandEmbedMarkersInHtml(html) {
  if (typeof html !== 'string' || !html.includes('data-article-embed-b64')) return html;
  return html.replace(EMBED_MARKER_RE, (_, b64) => decodeEmbedHtml(b64) || '');
}

/**
 * Script URLs to load after rendering HTML (same as admin `hydrateSocialEmbeds`).
 * React/Next must load these via next/script — inline script tags in HTML won't run via innerHTML.
 */
function collectEmbedScriptsForHtml(html) {
  if (typeof html !== 'string' || !html.length) return [];
  const scripts = [];
  if (/blockquote[^>]*twitter-tweet/i.test(html)) scripts.push(TWITTER_WIDGETS_SRC);
  if (/blockquote[^>]*instagram-media/i.test(html)) scripts.push(INSTAGRAM_EMBED_SRC);
  return scripts;
}

/**
 * Public article body pipeline aligned with ArticleContentRenderer:
 * 1. expand embed markers (base64 → blockquote/iframe)
 * 2. caller runs embedRelatedArticles + sanitizeArticleHtml
 */
function prepareArticleHtmlForDisplay(html) {
  return expandEmbedMarkersInHtml(html);
}

module.exports = {
  decodeEmbedHtml,
  expandEmbedMarkersInHtml,
  collectEmbedScriptsForHtml,
  prepareArticleHtmlForDisplay,
  TWITTER_WIDGETS_SRC,
  INSTAGRAM_EMBED_SRC,
  EMBED_MARKER_RE,
};
