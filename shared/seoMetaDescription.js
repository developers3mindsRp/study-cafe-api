'use strict';

/** Legacy WP theme truncates plain body text to ~140 chars for meta description. */
const WP_SEO_META_DESC_MAX_LEN = 140;

function stripHtmlToPlain(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeSeoPlain(text) {
  if (!text) return '';
  let s = String(text).replace(/\[related\s+id=['"]\d+['"]\]/gi, ' ');
  s = s.replace(/\bAlso\s+Read\b[:\s]*/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function deriveMetaDescriptionFromContent(html, maxLen = WP_SEO_META_DESC_MAX_LEN) {
  const plain = sanitizeSeoPlain(stripHtmlToPlain(html));
  if (!plain) return null;
  return plain.length > maxLen ? plain.slice(0, maxLen) : plain;
}

/**
 * Resolve SEO meta description for articles/courses.
 * Prefers stored meta_description (ACF), then excerpt/sub_heading/brief, then body snippet.
 */
function resolveModuleMetaDescription(source) {
  if (!source || typeof source !== 'object') return null;

  const pick = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };

  const direct = pick(source.meta_description);
  if (direct) return direct;

  const excerpt = pick(source.excerpt);
  if (excerpt) return excerpt;

  const subHeading = pick(source.sub_heading);
  if (subHeading) return subHeading;

  const brief = pick(source.brief_description);
  if (brief) return brief;

  const fromContent = deriveMetaDescriptionFromContent(source.content);
  if (fromContent) return fromContent;

  return deriveMetaDescriptionFromContent(source.description);
}

module.exports = {
  WP_SEO_META_DESC_MAX_LEN,
  stripHtmlToPlain,
  sanitizeSeoPlain,
  deriveMetaDescriptionFromContent,
  resolveModuleMetaDescription,
};
