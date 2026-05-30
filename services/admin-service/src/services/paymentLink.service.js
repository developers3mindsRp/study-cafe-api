const { Op, QueryTypes } = require('sequelize');
const { sequelize, PaymentLink } = require('../models');
const { AppError, logger } = require('../../../../shared');

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
      data.push({ ...plain, paid_orders_count: paid, seats_booked: paid });
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
    return { ...plain, paid_orders_count, seats_booked: paid_orders_count };
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
    await assertSlugUnique(payload.slug);
    const created = await PaymentLink.create(payload);
    const plain = created.get({ plain: true });
    return { ...plain, paid_orders_count: 0, seats_booked: 0 };
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
    if (patch.slug) await assertSlugUnique(patch.slug, id);
    const rvChanged =
      patch.random_value !== undefined && String(patch.random_value ?? '') !== String(prev.random_value ?? '');
    const totalChanged =
      patch.total_seats !== undefined && Number(patch.total_seats) !== Number(prev.total_seats);
    if (rvChanged || totalChanged) {
      patch.random_boost_accumulator = 0;
    }
    await row.update(patch);
    await row.reload();
    const plain = row.get({ plain: true });
    const paid_orders_count = await countPaidOrdersForPaymentLink(id);
    return { ...plain, paid_orders_count, seats_booked: paid_orders_count };
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

function attachPublicComputed(row) {
  const plain = { ...row };
  const paidCount = Number(plain.paid_count) || 0;
  delete plain.paid_count;

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
    ],
  });
  const out = [];
  for (const r of rows) {
    const plain = r.get({ plain: true });
    const paid = await countPaidOrdersForPaymentLink(plain.id);
    out.push(attachPublicComputed({ ...plain, paid_count: paid }));
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
  return attachPublicComputed({ ...plain, paid_count: paid, description: plain.description });
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
  return {
    ...plain,
    paid_count: paid,
    seats_remaining: Math.max(0, totalSeats - paid),
  };
}

module.exports = {
  slugify,
  parseRandomRange,
  randomStepFromRange,
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
