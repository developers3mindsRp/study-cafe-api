/**
 * Inclusive YYYY-MM-DD admin filters as calendar days in Asia/Kolkata (IST).
 * Used for created_at / joined_at style timestamp columns.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function parseYmdDateParts(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) };
}

function istDayStartInstant(dateStr) {
  const p = parseYmdDateParts(dateStr);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.mo, p.d, 0, 0, 0, 0) - IST_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

function istDayEndInstant(dateStr) {
  const p = parseYmdDateParts(dateStr);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.mo, p.d, 23, 59, 59, 999) - IST_OFFSET_MS);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveFilterRangeStart(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const ist = istDayStartInstant(s);
  if (ist) return ist;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveFilterRangeEnd(value) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  const ist = istDayEndInstant(s);
  if (ist) return ist;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Sequelize range on created_at for dateFrom/dateTo query params. */
function buildCreatedAtRange(dateFrom, dateTo, Op) {
  if (!dateFrom && !dateTo) return null;
  const range = {};
  const start = resolveFilterRangeStart(dateFrom);
  if (start) range[Op.gte] = start;
  const end = resolveFilterRangeEnd(dateTo);
  if (end) range[Op.lte] = end;
  // Op.gte / Op.lte are Symbols — Object.keys(range) is always [].
  if (start == null && end == null) return null;
  return range;
}

module.exports = {
  buildCreatedAtRange,
  resolveFilterRangeStart,
  resolveFilterRangeEnd,
};
