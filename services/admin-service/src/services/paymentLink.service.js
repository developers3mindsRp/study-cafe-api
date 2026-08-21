const { Op, QueryTypes } = require('sequelize');
const { sequelize, PaymentLink } = require('../models');
const courseClient = require('../clients/courseClient');
const platformClient = require('../clients/platformClient');
const { AppError, logger } = require('../../../../shared');

/** What a paid checkout on the link grants. 'custom' = money only, admin assigns by hand. */
const PRODUCT_TYPES = new Set(['custom', 'course', 'membership']);

function slugify(title) {
  const s = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'payment-link';
}

/**
 * Parse "min-max" or single number; returns { min, max } inclusive random increment.
 */
function parseRandomRange(randomValue) {
  if (randomValue == null || String(randomValue).trim() === '') {
    return { min: 0, max: 0 };
  }
  const raw = String(randomValue).trim();
  const parts = raw.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const min = Math.max(0, parseInt(parts[0], 10));
    const max = Math.max(min, parseInt(parts[parts.length - 1], 10));
    if (Number.isNaN(min) || Number.isNaN(max)) return { min: 0, max: 0 };
    return { min, max };
  }
  const n = parseInt(parts[0], 10);
  if (Number.isNaN(n)) return { min: 0, max: 0 };
  const v = Math.max(0, n);
  return { min: v, max: v };
}

function randomStepFromRange(randomValue) {
  const { min, max } = parseRandomRange(randomValue);
  if (max <= 0 && min <= 0) return 0;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Canonical key for comparing random_value strings (e.g. "1 - 3" vs "1-3"). */
function randomValueKey(randomValue) {
  const { min, max } = parseRandomRange(randomValue);
  if (max <= 0 && min <= 0) return '';
  if (min === max) return String(min);
  return `${min}-${max}`;
}

function totalSeatsKey(totalSeats) {
  if (totalSeats == null || totalSeats === '') return 0;
  const n = parseInt(String(totalSeats), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function parseBoostAccumulator(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const acc = parseInt(String(value), 10);
  if (!Number.isFinite(acc) || acc < 0) return null;
  return acc;
}

function normalizeProductType(value) {
  const t = value == null ? '' : String(value).trim().toLowerCase();
  return PRODUCT_TYPES.has(t) ? t : 'custom';
}

function normalizeProductId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Course / plan lookups back the admin form, every public page render and every
 * checkout, all for data that changes rarely — so a short TTL cache keeps a busy
 * link from hammering course-service on each page load.
 */
const PRODUCT_CACHE_TTL_MS = 60 * 1000;
const productCache = new Map();

/**
 * The linked course/plan.
 *
 * `missing` is only true when the owning service actually answered "not there" (404).
 * A timeout or 5xx leaves it false with a null product — the difference matters at
 * checkout, where a deleted course must stop the sale but a momentary blip in
 * course-service must not (the grant runs through the retrying outbox worker anyway).
 */
async function lookupProduct(productType, productId) {
  const type = normalizeProductType(productType);
  const id = normalizeProductId(productId);
  if (type === 'custom' || !id) return { product: null, missing: false };

  const key = `${type}:${id}`;
  const hit = productCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let result;
  try {
    const { data } =
      type === 'course'
        ? await courseClient.get(`/internal/courses/${encodeURIComponent(id)}`)
        : await platformClient.get(`/internal/platform/plans/${encodeURIComponent(id)}`);
    const product = data && data.id != null ? data : null;
    result = { product, missing: product == null };
  } catch (err) {
    const status = err?.response?.status;
    if (status !== 404) {
      logger.warn('[paymentLink] product lookup failed', { type, id, error: err.message, status });
      // Not cached — the next call should try again rather than inherit a blip.
      return { product: null, missing: false };
    }
    result = { product: null, missing: true };
  }

  productCache.set(key, { value: result, expires: Date.now() + PRODUCT_CACHE_TTL_MS });
  return result;
}

/** Display-only convenience: the product, or null when it can't be resolved for any reason. */
async function fetchProduct(productType, productId) {
  const { product } = await lookupProduct(productType, productId);
  return product;
}

/**
 * Write-path guard: an admin must not be able to save a link that points at nothing.
 * Strict on purpose — it refuses when the product can't be confirmed at all, so a
 * link is never published against a course we failed to verify.
 */
async function assertProductResolvable(productType, productId) {
  const type = normalizeProductType(productType);
  if (type === 'custom') return null;
  const id = normalizeProductId(productId);
  if (!id) {
    throw new AppError(
      type === 'course' ? 'Select a course for this payment link' : 'Select a membership plan for this payment link',
      400
    );
  }
  const { product, missing } = await lookupProduct(type, id);
  if (product) return product;
  throw new AppError(
    missing
      ? type === 'course'
        ? `Course ${id} was not found — pick an existing course`
        : `Membership plan ${id} was not found — pick an existing plan`
      : `Could not verify the linked ${type} right now — try saving again in a moment`,
    missing ? 400 : 503
  );
}

/** Public "what you get" block for the checkout page; null for money-only links. */
function buildPublicProduct(row, product) {
  const type = normalizeProductType(row.product_type);
  if (type === 'custom' || !product) return null;
  return {
    type,
    id: String(row.product_id),
    name: product.title || product.name || null,
    slug: product.slug || null,
    thumbnail_url: type === 'course' ? product.thumbnail_url || null : null,
    auto_enroll: row.auto_enroll !== false,
  };
}

/**
 * On each call (e.g. public checkout page load): add random step in range to persisted accumulator.
 * Display sold = paid orders + accumulator (capped by total_seats when > 0).
 */
async function applyIncrementalBoost(linkId) {
  return sequelize.transaction(async (t) => {
    const row = await PaymentLink.findByPk(linkId, {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!row) return null;
    const plain = row.get({ plain: true });
    const paidCount = await countPaidOrdersForPaymentLink(linkId, { transaction: t });
    let inc = randomStepFromRange(plain.random_value);
    const totalSeats = Number(plain.total_seats) || 0;
    let acc = Number(plain.random_boost_accumulator) || 0;
    if (totalSeats > 0) {
      const room = Math.max(0, totalSeats - paidCount - acc);
      inc = Math.min(inc, room);
    }
    acc += inc;
    await row.update({ random_boost_accumulator: acc }, { transaction: t });
    await row.reload({ transaction: t });
    return row.get({ plain: true });
  });
}

async function countPaidOrdersForPaymentLink(paymentLinkId, { transaction } = {}) {
  const opts = {
    replacements: { eid: String(paymentLinkId) },
    type: QueryTypes.SELECT,
  };
  if (transaction) opts.transaction = transaction;
  const rows = await sequelize.query(
    `SELECT COUNT(*) AS c FROM orders WHERE type = 'payment_link' AND entity_id = :eid AND status = 'paid'`,
    opts
  );
  const row = rows && rows[0];
  return Number(row?.c ?? row?.C ?? 0) || 0;
}

function validatePayload(body, { partial = false } = {}) {
  const title = body.title != null ? String(body.title).trim() : '';
  const slugIn = body.slug != null ? String(body.slug).trim() : '';
  const description = body.description != null ? body.description : null;
  const amount = body.amount != null ? Number(body.amount) : NaN;
  const salePrice = body.sale_price != null ? Number(body.sale_price) : NaN;
  const expiry = body.expiry ? new Date(body.expiry) : null;
  const totalSeats =
    body.total_seats != null && body.total_seats !== '' ? parseInt(String(body.total_seats), 10) : NaN;
  const randomValue =
    body.random_value != null && String(body.random_value).trim() !== ''
      ? String(body.random_value).trim()
      : null;
  let status = body.status != null ? String(body.status).trim().toLowerCase() : 'draft';
  if (status !== 'publish' && status !== 'draft') status = 'draft';

  const productType = normalizeProductType(body.product_type);
  // A money-only link carries no product — clear the fields so switching a link back
  // to 'custom' cannot leave a stale course id behind that fulfilment would act on.
  const productId = productType === 'custom' ? null : normalizeProductId(body.product_id);
  const batchRaw =
    productType === 'course' && body.batch_id != null && String(body.batch_id).trim() !== ''
      ? parseInt(String(body.batch_id), 10)
      : NaN;
  const batchId = Number.isFinite(batchRaw) && batchRaw > 0 ? batchRaw : null;
  // Defaults on. Accepts the string forms a form post can send as well as real booleans.
  const autoEnrollFalsey = [false, 0, '0', 'false'];
  const autoEnroll =
    body.auto_enroll === undefined ? true : !autoEnrollFalsey.includes(body.auto_enroll);

  if (!partial) {
    if (!title) throw new AppError('Title is required', 400);
    if (!Number.isFinite(amount) || amount < 0) throw new AppError('Invalid amount', 400);
    if (!Number.isFinite(salePrice) || salePrice < 0) throw new AppError('Invalid sale price', 400);
    if (!expiry || Number.isNaN(expiry.getTime())) throw new AppError('Invalid expiry', 400);
    if (!Number.isFinite(totalSeats) || totalSeats < 0) throw new AppError('Invalid total seats', 400);
  }

  const out = {};
  if (!partial || body.title !== undefined) out.title = title || undefined;
  if (!partial || body.slug !== undefined) out.slug = slugIn ? slugify(slugIn) : undefined;
  if (!partial || body.description !== undefined) out.description = description;
  if (!partial || body.amount !== undefined) out.amount = Number.isFinite(amount) ? amount : undefined;
  if (!partial || body.sale_price !== undefined)
    out.sale_price = Number.isFinite(salePrice) ? salePrice : undefined;
  if (!partial || body.expiry !== undefined) out.expiry = expiry && !Number.isNaN(expiry.getTime()) ? expiry : undefined;
  if (!partial || body.total_seats !== undefined)
    out.total_seats = Number.isFinite(totalSeats) ? totalSeats : undefined;
  if (!partial || body.random_value !== undefined) out.random_value = randomValue;
  if (!partial || body.status !== undefined) out.status = status;
  // product_id / batch_id follow product_type: changing the type has to be able to
  // null them out, so they travel together rather than being patched one at a time.
  if (!partial || body.product_type !== undefined || body.product_id !== undefined) {
    out.product_type = productType;
    out.product_id = productId;
    out.batch_id = batchId;
  } else if (body.batch_id !== undefined) {
    out.batch_id = batchId;
  }
  if (!partial || body.auto_enroll !== undefined) out.auto_enroll = autoEnroll;

  if (!partial) {
    if (!out.slug) out.slug = slugify(title);
    return {
      title: out.title,
      slug: out.slug,
      description: out.description,
      amount: out.amount,
      sale_price: out.sale_price,
      expiry: out.expiry,
      total_seats: out.total_seats,
      random_value: out.random_value,
      status: out.status,
      product_type: out.product_type,
      product_id: out.product_id,
      batch_id: out.batch_id,
      auto_enroll: out.auto_enroll,
    };
  }

  const merged = {};
  for (const [k, v] of Object.entries(out)) {
    if (v !== undefined) merged[k] = v;
  }
  return merged;
}

async function assertSlugUnique(slug, excludeId) {
  const where = { slug };
  if (excludeId) where.id = { [Op.ne]: excludeId };
  const existing = await PaymentLink.findOne({ where });
  if (existing) throw new AppError('Slug already in use', 409);
}

async function listPaymentLinks({ limit = 100, offset = 0, status, search } = {}) {
  try {
    const where = {};
    if (status) where.status = status;
    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      where[Op.or] = [{ title: { [Op.like]: q } }, { slug: { [Op.like]: q } }];
    }
    const total = await PaymentLink.count({ where });
    const rows = await PaymentLink.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: Math.min(Number(limit) || 100, 500),
      offset: Number(offset) || 0,
    });
    const data = [];
    for (const r of rows) {
      const plain = r.get({ plain: true });
      const paid = await countPaidOrdersForPaymentLink(plain.id);
      const product = await fetchProduct(plain.product_type, plain.product_id);
      data.push({
        ...plain,
        paid_orders_count: paid,
        seats_booked: paid,
        product: buildPublicProduct(plain, product),
      });
    }
    return {
      data,
      meta: {
        total,
        limit: Math.min(Number(limit) || 100, 500),
        offset: Number(offset) || 0,
      },
    };
  } catch (err) {
    logger.error('[paymentLink] listPaymentLinks failed', {
      error: err.message,
      payload: { limit, offset, status, search },
    });
    throw err;
  }
}

async function getPaymentLinkById(id) {
  try {
    const row = await PaymentLink.findByPk(id);
    if (!row) throw new AppError('Payment link not found', 404);
    const plain = row.get({ plain: true });
    const paid_orders_count = await countPaidOrdersForPaymentLink(id);
    const product = await fetchProduct(plain.product_type, plain.product_id);
    return {
      ...plain,
      paid_orders_count,
      seats_booked: paid_orders_count,
      product: buildPublicProduct(plain, product),
    };
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentLink] getPaymentLinkById failed', { error: err.message, id });
    }
    throw err;
  }
}

async function createPaymentLink(body) {
  try {
    const payload = validatePayload(body, { partial: false });
    const acc = parseBoostAccumulator(body.random_boost_accumulator);
    payload.random_boost_accumulator = acc != null ? acc : 0;
    const product = await assertProductResolvable(payload.product_type, payload.product_id);
    await assertSlugUnique(payload.slug);
    const created = await PaymentLink.create(payload);
    const plain = created.get({ plain: true });
    return { ...plain, paid_orders_count: 0, seats_booked: 0, product: buildPublicProduct(plain, product) };
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentLink] createPaymentLink failed', {
        error: err.message,
        payload: body,
      });
    }
    throw err;
  }
}

async function updatePaymentLink(id, body) {
  try {
    const row = await PaymentLink.findByPk(id);
    if (!row) throw new AppError('Payment link not found', 404);
    const prev = row.get({ plain: true });
    const patch = validatePayload({ ...prev, ...body }, { partial: true });
    delete patch.seats_booked;
    const product = await assertProductResolvable(
      patch.product_type !== undefined ? patch.product_type : prev.product_type,
      patch.product_id !== undefined ? patch.product_id : prev.product_id
    );
    if (patch.slug) await assertSlugUnique(patch.slug, id);
    const rvChanged =
      Object.prototype.hasOwnProperty.call(body, 'random_value') &&
      randomValueKey(body.random_value) !== randomValueKey(prev.random_value);
    const totalChanged =
      Object.prototype.hasOwnProperty.call(body, 'total_seats') &&
      totalSeatsKey(body.total_seats) !== totalSeatsKey(prev.total_seats);

    if (rvChanged || totalChanged) {
      // Changing random_value or total_seats resets accumulator unless admin set a new start in same request.
      const acc = parseBoostAccumulator(body.random_boost_accumulator);
      patch.random_boost_accumulator = acc != null ? acc : 0;
    } else if (Object.prototype.hasOwnProperty.call(body, 'random_boost_accumulator')) {
      const acc = parseBoostAccumulator(body.random_boost_accumulator);
      if (acc != null) {
        patch.random_boost_accumulator = acc;
      }
    }
    await row.update(patch);
    await row.reload();
    const plain = row.get({ plain: true });
    const paid_orders_count = await countPaidOrdersForPaymentLink(id);
    return {
      ...plain,
      paid_orders_count,
      seats_booked: paid_orders_count,
      product: buildPublicProduct(plain, product),
    };
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentLink] updatePaymentLink failed', {
        error: err.message,
        id,
        payload: body,
      });
    }
    throw err;
  }
}

async function deletePaymentLink(id) {
  try {
    const row = await PaymentLink.findByPk(id);
    if (!row) throw new AppError('Payment link not found', 404);
    await row.destroy();
  } catch (err) {
    if (!err.isOperational) {
      logger.error('[paymentLink] deletePaymentLink failed', { error: err.message, id });
    }
    throw err;
  }
}

function attachPublicComputed(row, product) {
  const plain = { ...row };
  const paidCount = Number(plain.paid_count) || 0;
  delete plain.paid_count;

  plain.product = buildPublicProduct(plain, product);
  // The raw product id/type stay on the payload (course ids are public anyway) so the
  // checkout page can deep-link to the course; `product` is the display block.
  plain.product_type = normalizeProductType(plain.product_type);
  // Internal fulfilment detail — the buyer has no use for it and it only leaks batch ids.
  delete plain.batch_id;

  const acc = Number(plain.random_boost_accumulator) || 0;
  delete plain.random_boost_accumulator;

  delete plain.seats_booked;
  const totalSeats = Number(plain.total_seats) || 0;
  plain.seats_booked = paidCount;
  /** Paid checkouts + marketing random boost (capped by total_seats when set). */
  plain.display_sold = Math.min(totalSeats || Infinity, paidCount + acc);

  if (totalSeats > 0) {
    plain.seats_remaining = Math.max(0, totalSeats - paidCount);
  }

  const exp = plain.expiry ? new Date(plain.expiry) : null;
  plain.expires_at = exp && !Number.isNaN(exp.getTime()) ? exp.toISOString() : null;

  return plain;
}

async function listPublishedPublic() {
  const rows = await PaymentLink.findAll({
    where: { status: 'publish' },
    order: [['created_at', 'DESC']],
    attributes: [
      'id',
      'title',
      'slug',
      'amount',
      'sale_price',
      'expiry',
      'total_seats',
      'random_value',
      'random_boost_accumulator',
      'status',
      'product_type',
      'product_id',
      'auto_enroll',
    ],
  });
  const out = [];
  for (const r of rows) {
    const plain = r.get({ plain: true });
    const paid = await countPaidOrdersForPaymentLink(plain.id);
    const product = await fetchProduct(plain.product_type, plain.product_id);
    out.push(attachPublicComputed({ ...plain, paid_count: paid }, product));
  }
  return out;
}

async function getPublishedBySlug(slug) {
  const row = await PaymentLink.findOne({
    where: { slug: String(slug), status: 'publish' },
  });
  if (!row) throw new AppError('Payment link not found', 404);
  const boosted = await applyIncrementalBoost(row.id);
  const plain = boosted || row.get({ plain: true });
  const paid = await countPaidOrdersForPaymentLink(plain.id);
  const product = await fetchProduct(plain.product_type, plain.product_id);
  return attachPublicComputed({ ...plain, paid_count: paid, description: plain.description }, product);
}

async function getInternalForCheckout(id) {
  const row = await PaymentLink.findByPk(id);
  if (!row) throw new AppError('Payment link not found', 404);
  const plain = row.get({ plain: true });
  if (plain.status !== 'publish') throw new AppError('Payment link is not published', 400);
  const exp = plain.expiry ? new Date(plain.expiry) : null;
  if (exp && !Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
    throw new AppError('Payment link has expired', 400);
  }
  const paid = await countPaidOrdersForPaymentLink(plain.id);
  const totalSeats = Number(plain.total_seats) || 0;
  if (totalSeats > 0 && paid >= totalSeats) {
    throw new AppError('No seats remaining', 400);
  }

  // Refuse to take money for a course/plan that has since been deleted — we could
  // never grant it, and a refund is worse for everyone than a blocked checkout.
  // Only a confirmed 404 blocks; an unreachable service does not (the outbox worker
  // retries the grant regardless).
  const { product, missing } = await lookupProduct(plain.product_type, plain.product_id);
  if (missing) {
    logger.error('[paymentLink] checkout blocked — linked product is gone', {
      paymentLinkId: plain.id,
      product_type: plain.product_type,
      product_id: plain.product_id,
    });
    throw new AppError('This offer is no longer available', 400);
  }

  return {
    ...plain,
    product_type: normalizeProductType(plain.product_type),
    product_name: product ? product.title || product.name || null : null,
    paid_count: paid,
    seats_remaining: Math.max(0, totalSeats - paid),
  };
}

module.exports = {
  slugify,
  parseRandomRange,
  randomStepFromRange,
  randomValueKey,
  totalSeatsKey,
  parseBoostAccumulator,
  normalizeProductType,
  lookupProduct,
  fetchProduct,
  countPaidOrdersForPaymentLink,
  listPaymentLinks,
  getPaymentLinkById,
  createPaymentLink,
  updatePaymentLink,
  deletePaymentLink,
  listPublishedPublic,
  getPublishedBySlug,
  getInternalForCheckout,
};
