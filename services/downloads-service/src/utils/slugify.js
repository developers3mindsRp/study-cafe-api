function slugify(text) {
  return text
    .toString()
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, '-')
    // Keep ASCII word chars, hyphen, and any Unicode letter/mark/number
    // (e.g. Devanagari). Strip punctuation/symbols only.
    .replace(/[^\p{L}\p{M}\p{N}_-]+/gu, '')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Build the set of slug strings to look up for a slug segment coming off the URL.
 * Legacy WP slugs for non-Latin titles (e.g. Hindi) are stored percent-encoded —
 * WordPress writes them lowercase (`%e0%a4%8f...`), while the router hands us the
 * decoded Devanagari. Return the decoded form plus lower/upper percent-encoded
 * variants so the lookup stays an indexed equality match against `slug`.
 *
 * Mirrors platform-service's article slug lookup so Hindi downloads resolve the
 * same way Hindi blog articles already do.
 */
function buildSlugLookupCandidates(urlSlug) {
  const raw = String(urlSlug ?? '').trim();
  if (!raw) return [];
  const set = new Set([raw]);
  // Decode first in case the caller already sent an encoded slug.
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed sequence — keep raw as-is.
  }
  set.add(decoded);
  // Per-segment encode (keep the `-` word separators readable, like WP post_name).
  try {
    const encoded = decoded.split('-').map((seg) => encodeURIComponent(seg)).join('-');
    set.add(encoded);
    set.add(encoded.toLowerCase());
    set.add(encoded.toUpperCase());
  } catch {
    // Ignore — decoded already covers the common case.
  }
  return [...set];
}

module.exports = { slugify, buildSlugLookupCandidates };
