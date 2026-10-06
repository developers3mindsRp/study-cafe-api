const crypto = require('crypto');
const axios = require('axios');
const { Op, QueryTypes } = require('sequelize');
const { sequelize, CertificateLink, CertificateLinkClaim, Course } = require('../models');
const { AppError, logger, paginate } = require('../../../../shared');
const config = require('../config');
const { assignSerial, formatCertificateSerial } = require('./certificateSerial.service');

/**
 * Public certificate download links.
 *
 * An admin creates a link for a course with an expiry. Anyone who opens it types name / phone /
 * email and gets the certificate — no login, no purchase, no course progress. Submissions double
 * as a lead list.
 *
 * Security posture, decided with the client: there is NO identity verification. Whoever holds the
 * link can mint an official SC- serial against any name they type. The protections here are
 * deduplication, per-link caps and throttling — they are what keeps that from being abused at
 * scale, so treat them as load-bearing rather than optional.
 *
 * The endpoints this backs are UNAUTHENTICATED. They must never answer 401 or 403: the web app's
 * axios interceptor hard-redirects a 401 to /login, which would bounce a visitor to a screen they
 * cannot use. Use 404 / 409 / 410 / 422 / 429 instead.
 */

/** 16 bytes -> 32 hex chars. The token is a bearer secret; never log it in full. */
const TOKEN_BYTES = 16;
const TOKEN_ATTEMPTS = 3;

/** Time trap bounds for the public form (see claim()). */
const MIN_FORM_FILL_MS = 1500;
const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1000;

/** Claims list paging goes higher than the shared paginate() cap so CSV export can batch. */
const CLAIMS_MAX_LIMIT = 500;

// ── Small helpers ──────────────────────────────────────────────────

/** Tokens are secrets — log only enough to correlate. */
function maskToken(token) {
  const t = String(token || '');
  return t ? `${t.slice(0, 6)}…` : '(none)';
}

/**
 * Identity for a public certificate. Nothing cleverer than trim+lowercase on purpose: gmail dot /
 * +tag stripping breaks real users and makes the lead export look wrong.
 */
function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase().slice(0, 190);
}

/**
 * Digits only, keeping a leading +. Captured for the lead list and the per-phone throttle bucket,
 * but deliberately NOT part of any key — a composite (email, phone) identity would let one email
 * mint N serials by varying a digit.
 */
function normalizePhone(v) {
  const raw = String(v || '').trim();
  if (!raw) return null;
  const plus = raw.startsWith('+') ? '+' : '';
  const digits = raw.replace(/[^0-9]/g, '');
  return digits ? `${plus}${digits}`.slice(0, 32) : null;
}

function cleanName(v) {
  return String(v || '').trim().replace(/\s+/g, ' ').slice(0, 190);
}

function clip(v, max) {
  const s = v == null ? null : String(v).trim();
  return s ? s.slice(0, max) : null;
}

function toDateOnly(d) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * One computed field the whole UI can switch on, instead of every caller re-deriving it from
 * status + expires_at + max_claims. Expiry is COMPUTED, never stored — a past expires_at behaves
 * exactly like `disabled`, so there is no cron job to run.
 */
function effectiveStatus(link, now = new Date()) {
  if (!link) return null;
  if (link.deleted_at) return 'deleted';
  if (link.status === 'draft') return 'draft';
  if (link.status === 'disabled') return 'disabled';
  if (link.expires_at && new Date(link.expires_at).getTime() <= now.getTime()) return 'expired';
  if (link.max_claims != null && Number(link.claims_count) >= Number(link.max_claims)) return 'full';
  return 'active';
}

function plain(row) {
  if (!row) return null;
  return typeof row.get === 'function' ? row.get({ plain: true }) : row;
}

/** Admin-facing shape: everything, plus the computed status and the course title. */
function toAdminJson(row) {
  const link = plain(row);
  if (!link) return null;
  const course = link.Course ? plain(link.Course) : null;
  const { Course: _course, ...rest } = link;
  return {
    ...rest,
    effective_status: effectiveStatus(link),
    course_title: course?.title || null,
    course_certificate_enabled: course ? course.certificate_enabled !== false : null,
  };
}

// ── Token allocation ───────────────────────────────────────────────

async function allocateUniqueToken() {
  for (let i = 0; i < TOKEN_ATTEMPTS; i++) {
    const token = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    const clash = await CertificateLink.findOne({
      where: { token },
      attributes: ['id'],
      paranoid: false,
    });
    if (!clash) return token;
  }
  throw new AppError('Could not allocate a unique certificate link token', 500);
}

// ── Lookups ────────────────────────────────────────────────────────

async function findLinkByToken(token) {
  if (!token) return null;
  return CertificateLink.findOne({ where: { token: String(token) }, paranoid: false });
}

/**
 * Deliberately NOT coursesService.getByIdInternal() — that enriches authors, categories, batches,
 * sessions and recordings. The claim path needs three columns, on an unauthenticated endpoint.
 */
async function loadCourseLite(courseId) {
  const row = await Course.findByPk(courseId, {
    attributes: ['id', 'title', 'certificate_enabled', 'deleted_at'],
    paranoid: false,
  });
  return plain(row);
}

function courseCanIssue(course) {
  if (!course) return false;
  if (course.deleted_at) return false;
  return course.certificate_enabled !== false && course.certificate_enabled !== 0;
}

async function findPublicCertificate(courseId, emailNorm, t = null) {
  const rows = await sequelize.query(
    `SELECT id, serial, name, issued_at FROM public_certificates
      WHERE course_id = :cid AND email_norm = :email LIMIT 1`,
    {
      replacements: { cid: courseId, email: emailNorm },
      type: QueryTypes.SELECT,
      transaction: t || undefined,
    },
  );
  return rows[0] || null;
}

// ── Throttling ─────────────────────────────────────────────────────

/**
 * DB-backed, not Redis. course-service has no Redis client and this write path has no runtime
 * dependency on one; adding it would buy a new failure mode (Redis down -> either fail-closed on
 * real users or fail-open with the throttle silently off) for a few claims per minute. Every check
 * below is a range scan on a composite index, and abusive rows stay visible in the admin claims
 * list. If claim volume ever reaches hundreds/minute, swap countRecent() for the INCR/EXPIRE
 * pattern in services/auth-service/src/services/auth.service.js behind the same signature.
 */
async function countRecent(sql, replacements) {
  const rows = await sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
  return Number(rows[0]?.c || 0);
}

function throttled(message, retryAfterSeconds) {
  const err = new AppError(message, 429);
  err.retryAfter = retryAfterSeconds;
  return err;
}

/**
 * Runs BEFORE any transaction is opened, cheapest bucket first — the counter row lock must never
 * be held across this work. Only reached for a NEW identity: a repeat claim dedupes earlier, so
 * these buckets count identities created rather than honest re-downloads.
 */
async function assertWithinThrottles({ link, emailNorm, phoneNorm, ip }) {
  const limits = config.certificateClaim;

  if (ip) {
    const perHour = await countRecent(
      `SELECT COUNT(*) AS c FROM certificate_link_claims
        WHERE ip = :ip AND created_at >= NOW() - INTERVAL 1 HOUR`,
      { ip },
    );
    if (perHour >= limits.maxPerIpHour) {
      throw throttled('Too many certificate requests from this network. Please try again later.', 3600);
    }

    const perDay = await countRecent(
      `SELECT COUNT(*) AS c FROM certificate_link_claims
        WHERE ip = :ip AND created_at >= NOW() - INTERVAL 1 DAY`,
      { ip },
    );
    if (perDay >= limits.maxPerIpDay) {
      throw throttled('Too many certificate requests from this network today. Please try again tomorrow.', 3600);
    }
  }

  const perLink = await countRecent(
    `SELECT COUNT(*) AS c FROM certificate_link_claims
      WHERE link_id = :lid AND created_at >= NOW() - INTERVAL 1 MINUTE`,
    { lid: link.id },
  );
  if (perLink >= limits.maxPerLinkMinute) {
    throw throttled('This certificate link is busy right now. Please try again in a minute.', 60);
  }

  const perEmail = await countRecent(
    `SELECT COUNT(*) AS c FROM public_certificates
      WHERE email_norm = :email AND created_at >= NOW() - INTERVAL 1 DAY`,
    { email: emailNorm },
  );
  if (perEmail >= limits.maxPerEmailDay) {
    throw throttled('This email address has requested too many certificates today.', 3600);
  }

  if (phoneNorm) {
    const emailsPerPhone = await countRecent(
      `SELECT COUNT(DISTINCT email_norm) AS c FROM certificate_link_claims
        WHERE phone_norm = :phone AND created_at >= NOW() - INTERVAL 1 DAY`,
      { phone: phoneNorm },
    );
    if (emailsPerPhone >= limits.maxEmailsPerPhoneDay) {
      throw throttled('This phone number has requested too many certificates today.', 3600);
    }
  }
}

// ── Writes on the claim path ───────────────────────────────────────

/**
 * Per-link cap, as a conditional UPDATE rather than read-then-write — the WHERE clause is the
 * check, so two concurrent claims can never both pass a cap of 1. Runs inside the claim
 * transaction (via assignSerial's beforeAllocate hook), so a rollback undoes the counter
 * increment and this bump together.
 *
 * Note the cap counts serials ISSUED through this link. A claimant who already holds a serial for
 * this course (from another link) still gets a lead row but does not consume cap — that path never
 * reaches the counter at all.
 */
async function reserveLinkCapacity(linkId, t) {
  const [, meta] = await sequelize.query(
    `UPDATE certificate_links
        SET claims_count = claims_count + 1, updated_at = NOW()
      WHERE id = :id
        AND deleted_at IS NULL
        AND (max_claims IS NULL OR claims_count < max_claims)`,
    { replacements: { id: linkId }, type: QueryTypes.UPDATE, transaction: t },
  );
  // Sequelize returns [results, affectedRows] for UPDATE statements
  const affected = typeof meta === 'number' ? meta : (meta?.affectedRows ?? 0);
  if (affected === 0) {
    throw new AppError('This certificate link has reached its limit.', 409);
  }
}

async function insertPublicCertificate({ courseId, emailNorm, name, phoneNorm, serial }, t) {
  await sequelize.query(
    `INSERT INTO public_certificates
       (course_id, email_norm, name, phone_norm, serial, issued_at, created_at, updated_at)
     VALUES (:cid, :email, :name, :phone, :serial, NOW(), NOW(), NOW())`,
    {
      replacements: { cid: courseId, email: emailNorm, name, phone: phoneNorm, serial },
      type: QueryTypes.INSERT,
      transaction: t,
    },
  );
  const rows = await sequelize.query(
    `SELECT id FROM public_certificates WHERE course_id = :cid AND email_norm = :email LIMIT 1`,
    { replacements: { cid: courseId, email: emailNorm }, type: QueryTypes.SELECT, transaction: t },
  );
  return rows[0]?.id != null ? Number(rows[0].id) : null;
}

/**
 * One lead row per (link, email). A repeat claim through the SAME link is an honest re-download:
 * bump the counter and the timestamp, and leave the originally captured lead data alone.
 */
async function upsertClaimRow(row, t = null) {
  await sequelize.query(
    `INSERT INTO certificate_link_claims
       (link_id, public_certificate_id, course_id, serial, name, email, email_norm,
        phone, phone_norm, ip, user_agent, utm_source, utm_medium, utm_campaign,
        download_count, last_claimed_at, created_at, updated_at)
     VALUES
       (:linkId, :pubId, :courseId, :serial, :name, :email, :emailNorm,
        :phone, :phoneNorm, :ip, :userAgent, :utmSource, :utmMedium, :utmCampaign,
        1, NOW(), NOW(), NOW())
     ON DUPLICATE KEY UPDATE
        download_count = download_count + 1,
        last_claimed_at = NOW(),
        updated_at = NOW()`,
    { replacements: row, type: QueryTypes.INSERT, transaction: t || undefined },
  );
}

// ── Public reads ───────────────────────────────────────────────────

/**
 * What the public claim page renders before anyone submits. Returns NO course_id, no raw counts
 * and no lead data — the token is handed to strangers.
 */
async function getPublicByToken(token) {
  const link = plain(await findLinkByToken(token));
  // draft and soft-deleted links do not exist as far as the public is concerned.
  if (!link || link.deleted_at || link.status === 'draft') {
    throw new AppError('Certificate link not found', 404);
  }

  const course = await loadCourseLite(link.course_id);
  let status = effectiveStatus(link);
  // A course that can no longer issue reads as closed, so the page shows friendly copy instead of
  // a form whose submit is guaranteed to fail.
  if (status === 'active' && !courseCanIssue(course)) status = 'expired';
  if (status === 'disabled') status = 'expired';

  return {
    token: link.token,
    title: link.title,
    description: link.description || null,
    courseTitle: course?.title?.trim() || null,
    status,
    claimsRemaining:
      link.max_claims == null ? null : Math.max(0, Number(link.max_claims) - Number(link.claims_count)),
    /** Server clock, echoed back by the form — see the time trap in claim(). */
    rendered_at: Date.now(),
  };
}

// ── The claim ──────────────────────────────────────────────────────

/**
 * Bot traps. Both respond like a success with nothing persisted, so a scripted claimer gets no
 * signal to adapt.
 *
 * `certificateNumber` comes back null rather than a fabricated serial: a serial is an official
 * record, and browser autofill can occasionally populate a honeypot despite the off-screen
 * wrapper, tabIndex={-1} and autoComplete="off". A real person who trips it sees a certificate
 * with "—" where the number goes and contacts support, instead of walking away with a number that
 * was never issued.
 */
function looksAutomated(payload) {
  if (payload.company_website) return true;
  const renderedAt = Number(payload.rendered_at);
  if (!Number.isFinite(renderedAt) || renderedAt <= 0) return false;
  const age = Date.now() - renderedAt;
  return age < MIN_FORM_FILL_MS || age > MAX_FORM_AGE_MS;
}

/**
 * Resolve a link for a claim attempt. Throws with the status the PUBLIC contract requires:
 *   404 unknown / soft-deleted / draft   410 expired or disabled   409 cap reached
 * Never 401 or 403.
 */
async function resolveLinkForClaim(token) {
  const link = plain(await findLinkByToken(token));
  if (!link || link.deleted_at || link.status === 'draft') {
    throw new AppError('Certificate link not found', 404);
  }
  const status = effectiveStatus(link);
  if (status === 'expired' || status === 'disabled') {
    throw new AppError('This certificate link has expired.', 410);
  }
  if (status === 'full') {
    throw new AppError('This certificate link has reached its limit.', 409);
  }
  return link;
}

/**
 * Issue (or re-issue) a certificate for one person against one link.
 *
 * Returns a payload identical in shape to the learner certificate endpoint
 * ({ courseTitle, studentName, completionDate, certificateNumber }) so the same artwork component
 * renders both without a branch.
 */
async function claim(token, payload, meta = {}) {
  const link = await resolveLinkForClaim(token);
  const course = await loadCourseLite(link.course_id);
  if (!courseCanIssue(course)) {
    throw new AppError('Certificates are not available for this course.', 422);
  }

  const courseTitle = course.title?.trim() || 'Course';
  // An admin running a webinar wants the event date printed, not the day someone happened to claim.
  const completionDate = link.certificate_date
    ? toDateOnly(link.certificate_date)
    : toDateOnly(new Date());

  const name = cleanName(payload.name);
  const emailNorm = normalizeEmail(payload.email);
  const phoneNorm = normalizePhone(payload.phone);

  if (looksAutomated(payload)) {
    logger.warn('[certificate-link] claim rejected by bot trap', {
      token: maskToken(token),
      ip: meta.ip || null,
    });
    return { courseTitle, studentName: name, completionDate, certificateNumber: null };
  }

  const claimRow = {
    linkId: link.id,
    pubId: null,
    courseId: link.course_id,
    serial: null,
    name,
    email: clip(payload.email, 190),
    emailNorm,
    phone: clip(payload.phone, 32),
    phoneNorm,
    ip: clip(meta.ip, 45),
    userAgent: clip(meta.userAgent, 255),
    utmSource: clip(payload.utm_source, 190),
    utmMedium: clip(payload.utm_medium, 190),
    utmCampaign: clip(payload.utm_campaign, 190),
  };

  // Fast path: this person already holds a serial for this course. Never mint, never open a
  // transaction, never touch the counter or the cap — just record the lead for THIS link.
  const existing = await findPublicCertificate(link.course_id, emailNorm);
  if (existing) {
    await upsertClaimRow({ ...claimRow, pubId: Number(existing.id), serial: Number(existing.serial) });
    return {
      courseTitle,
      // Frozen at first claim. Returning the just-submitted name instead would let anyone
      // re-submit against a known email and print an arbitrary name on an issued serial.
      studentName: existing.name,
      completionDate: issuedCertificateDate(link, existing),
      certificateNumber: formatCertificateSerial(existing.serial),
    };
  }

  await assertWithinThrottles({ link, emailNorm, phoneNorm, ip: meta.ip });

  let frozenName = name;
  let publicCertificateId = null;
  let leadRecorded = false;

  const serial = await assignSerial({
    context: { linkId: link.id, courseId: link.course_id, token: maskToken(token) },
    readExisting: async (t) => {
      const row = await findPublicCertificate(link.course_id, emailNorm, t);
      if (!row) return null;
      publicCertificateId = Number(row.id);
      frozenName = row.name;
      return Number(row.serial);
    },
    beforeAllocate: (t) => reserveLinkCapacity(link.id, t),
    insertWithSerial: async (allocated, t) => {
      publicCertificateId = await insertPublicCertificate(
        { courseId: link.course_id, emailNorm, name, phoneNorm, serial: allocated },
        t,
      );
      await upsertClaimRow({ ...claimRow, pubId: publicCertificateId, serial: allocated }, t);
      leadRecorded = true;
    },
  });

  if (serial == null) {
    throw new AppError('Could not issue a certificate right now. Please try again.', 503);
  }

  // Lost the allocation race: the identity got its serial from a concurrent request, so only the
  // lead row for this link is still missing.
  if (!leadRecorded) {
    await upsertClaimRow({ ...claimRow, pubId: publicCertificateId, serial });
  }

  if (link.send_email && leadRecorded) {
    sendClaimEmail({
      to: String(payload.email || '').trim(),
      name: frozenName,
      courseTitle,
      completionDate,
      certificateNumber: formatCertificateSerial(serial),
      token: link.token,
    });
  }

  return {
    courseTitle,
    studentName: frozenName,
    completionDate,
    certificateNumber: formatCertificateSerial(serial),
  };
}

/**
 * The date printed on a certificate someone ALREADY holds: the link's event date when set,
 * otherwise the day it was first issued — not today, or a re-download prints a different date.
 */
function issuedCertificateDate(link, existing) {
  if (link.certificate_date) return toDateOnly(link.certificate_date);
  return toDateOnly(existing.issued_at || new Date());
}

/**
 * Re-show a certificate that was ALREADY issued, by email alone. Never mints a serial.
 *
 * The claim email's button points at the claim page, and a link expires, gets disabled or fills
 * up long after that email lands — so unlike claim(), this ignores the link's status and refuses
 * only links that should not be known to exist (unknown, draft, soft-deleted). Closing a link
 * stops NEW certificates; it does not take back the ones people hold. For the same reason the
 * course's certificate_enabled flag is not checked here.
 *
 * Exposes nothing claim() does not already return for a known email on an active link.
 */
async function retrieve(token, payload) {
  const link = plain(await findLinkByToken(token));
  if (!link || link.deleted_at || link.status === 'draft') {
    throw new AppError('Certificate link not found', 404);
  }

  const emailNorm = normalizeEmail(payload.email);
  const existing = await findPublicCertificate(link.course_id, emailNorm);
  if (!existing) {
    throw new AppError(
      'No certificate was found for this email. Use the same email address you entered when you first got your certificate.',
      404,
    );
  }

  // Count the re-download on this link's lead row when there is one; never create a lead row here.
  await sequelize.query(
    `UPDATE certificate_link_claims
        SET download_count = download_count + 1, last_claimed_at = NOW(), updated_at = NOW()
      WHERE link_id = :lid AND email_norm = :email`,
    { replacements: { lid: link.id, email: emailNorm }, type: QueryTypes.UPDATE },
  );

  const course = await loadCourseLite(link.course_id);
  return {
    courseTitle: course?.title?.trim() || 'Course',
    studentName: existing.name,
    completionDate: issuedCertificateDate(link, existing),
    certificateNumber: formatCertificateSerial(existing.serial),
  };
}

/**
 * Fire-and-forget "your certificate is ready" email, first claim only. No PDF is attached — the
 * client asked for the email to carry only the claim link, where the certificate is downloaded.
 *
 * Deliberately does NOT pass userId/courseId: auth-service attaches the learner PDF when both are
 * set, which would also go through getCertificateDataInternal() and its completed-progress check.
 */
function sendClaimEmail({ to, name, courseTitle, completionDate, certificateNumber, token }) {
  if (!to) return;
  (async () => {
    try {
      await axios.post(
        `${config.authServiceUrl}/internal/send-course-completion-certificate-email`,
        {
          to,
          name,
          courseTitle,
          completionDate,
          certificateNumber,
          claimUrl: `${config.publicSiteUrl}/certificate/${token}`,
        },
        { headers: { 'x-internal-api-key': config.internalApiKey }, timeout: 15000 },
      );
    } catch (err) {
      logger.warn('[certificate-link] claim email failed', {
        token: maskToken(token),
        err: err?.message || String(err),
      });
    }
  })();
}

/** Fields the emailed PDF is built from. Used by the internal PDF endpoint. */
async function getPublicCertificateForPdf(publicCertificateId) {
  const rows = await sequelize.query(
    `SELECT pc.id, pc.name, pc.serial, pc.course_id, c.title AS course_title
       FROM public_certificates pc
       LEFT JOIN courses c ON c.id = pc.course_id
      WHERE pc.id = :id LIMIT 1`,
    { replacements: { id: publicCertificateId }, type: QueryTypes.SELECT },
  );
  const row = rows[0];
  if (!row) return null;

  // Prefer the certificate_date of the most recent link this person claimed through, so the PDF
  // matches the PNG they downloaded on the page.
  const dateRows = await sequelize.query(
    `SELECT l.certificate_date, cl.created_at
       FROM certificate_link_claims cl
       JOIN certificate_links l ON l.id = cl.link_id
      WHERE cl.public_certificate_id = :id
      ORDER BY cl.created_at DESC LIMIT 1`,
    { replacements: { id: publicCertificateId }, type: QueryTypes.SELECT },
  );
  const d = dateRows[0];

  return {
    studentName: row.name,
    courseTitle: row.course_title?.trim() || 'Course',
    completionDate: toDateOnly(d?.certificate_date || d?.created_at || new Date()),
    certificateNumber: formatCertificateSerial(row.serial),
  };
}

// ── Admin CRUD (internal) ──────────────────────────────────────────

const ADMIN_COURSE_INCLUDE = {
  model: Course,
  as: 'Course',
  attributes: ['id', 'title', 'certificate_enabled'],
  required: false,
  paranoid: false,
};

async function listInternal(query = {}) {
  const where = {};
  const search = String(query.search || '').trim();
  if (search) {
    where[Op.or] = [{ title: { [Op.like]: `%${search}%` } }, { token: search }];
  }
  if (query.status) where.status = query.status;
  if (query.course_id) where.course_id = query.course_id;

  const { data, meta } = await paginate(CertificateLink, {
    where,
    page: query.page,
    limit: query.limit,
    sortBy: query.sortBy || 'created_at',
    sortOrder: query.sortOrder || 'DESC',
    include: [ADMIN_COURSE_INCLUDE],
    distinct: true,
  });

  return { data: data.map(toAdminJson), meta };
}

async function getByIdInternal(id) {
  const row = await CertificateLink.findByPk(id, { include: [ADMIN_COURSE_INCLUDE] });
  return toAdminJson(row);
}

async function createInternal(body, adminId = null) {
  const course = await loadCourseLite(body.course_id);
  if (!course || course.deleted_at) throw new AppError('Course not found', 404);

  const token = await allocateUniqueToken();
  const row = await CertificateLink.create({
    token,
    course_id: body.course_id,
    title: body.title,
    description: body.description ?? null,
    status: body.status || 'draft',
    expires_at: body.expires_at,
    certificate_date: body.certificate_date ?? null,
    max_claims: body.max_claims ?? null,
    claims_count: 0,
    send_email: body.send_email !== undefined ? body.send_email : true,
    created_by: adminId,
  });

  logger.info('[certificate-link] created', { id: row.id, token: maskToken(token), courseId: body.course_id });
  return getByIdInternal(row.id);
}

async function updateInternal(id, body) {
  const row = await CertificateLink.findByPk(id);
  if (!row) return null;

  // Changing the course after serials exist would print a different course on certificates that
  // are already in people's hands.
  if (
    body.course_id !== undefined &&
    Number(body.course_id) !== Number(row.course_id) &&
    Number(row.claims_count) > 0
  ) {
    throw new AppError('This link has already issued certificates — its course can no longer be changed.', 422);
  }

  if (body.course_id !== undefined) {
    const course = await loadCourseLite(body.course_id);
    if (!course || course.deleted_at) throw new AppError('Course not found', 404);
  }

  const patch = {};
  for (const field of [
    'course_id',
    'title',
    'description',
    'status',
    'expires_at',
    'certificate_date',
    'max_claims',
    'send_email',
  ]) {
    if (body[field] !== undefined) patch[field] = body[field];
  }
  await row.update(patch);
  return getByIdInternal(id);
}

/**
 * Soft delete only. The claim rows ARE the business value, and hard-deleting a link would orphan
 * serials that have already been printed.
 */
async function deleteInternal(id) {
  const row = await CertificateLink.findByPk(id);
  if (!row) return false;
  await row.destroy();
  return true;
}

async function listClaimsInternal(linkId, query = {}) {
  const link = await CertificateLink.findByPk(linkId, { paranoid: false });
  if (!link) return null;

  const where = { link_id: linkId };
  const search = String(query.search || '').trim();
  if (search) {
    where[Op.or] = [
      { name: { [Op.like]: `%${search}%` } },
      { email: { [Op.like]: `%${search}%` } },
      { phone: { [Op.like]: `%${search}%` } },
    ];
  }

  const page = Math.max(1, parseInt(String(query.page), 10) || 1);
  const limit = Math.min(CLAIMS_MAX_LIMIT, Math.max(1, parseInt(String(query.limit), 10) || 25));
  const { count, rows } = await CertificateLinkClaim.findAndCountAll({
    where,
    limit,
    offset: (page - 1) * limit,
    order: [['created_at', 'DESC']],
  });

  const totalPages = Math.ceil(count / limit) || 0;
  return {
    data: rows.map((r) => {
      const c = plain(r);
      return {
        ...c,
        certificate_number: formatCertificateSerial(c.serial),
        link_title: link.title,
      };
    }),
    meta: {
      total: count,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

module.exports = {
  // public
  getPublicByToken,
  claim,
  retrieve,
  // internal
  listInternal,
  getByIdInternal,
  createInternal,
  updateInternal,
  deleteInternal,
  listClaimsInternal,
  getPublicCertificateForPdf,
  // exported for tests / reuse
  effectiveStatus,
  normalizeEmail,
  normalizePhone,
};
