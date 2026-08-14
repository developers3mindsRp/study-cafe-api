const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, Role, UserMembership } = require('../models');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getEffectivePermissions, parseRolePermissions } = require('../config/permissions');
const { isDynamicRoleSchemaReady } = require('./rolesSchema');

function roleIncludeForSession() {
  return {
    model: Role,
    as: 'Role',
    attributes: isDynamicRoleSchemaReady() ? ['name', 'permissions'] : ['name'],
  };
}
const { AppError, logger } = require('../../../../shared');
const phpass = require('../utils/phpass');
const emailService = require('./email.service');

/**
 * Verify a password against any supported hash format:
 *   - bcrypt ($2a$, $2b$, $2y$)  — new registrations from this app
 *   - wp-bcrypt ($wp$2y$)         — WordPress 6.8+ migrated users (bcrypt with $wp$ prefix)
 *   - phpass ($P$, $H$)           — WordPress migrated users (older WP versions)
 *   - plain MD5 (32 hex chars)    — very old WordPress accounts
 *
 * On a successful phpass/MD5/wp-bcrypt login we silently upgrade the stored hash to bcrypt.
 */
async function verifyAndMaybeUpgradePassword(password, user) {
  const stored = user.password_hash;
  if (!stored) return false;

  // bcrypt — the normal path for new users
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    return bcrypt.compare(password, stored);
  }

  // WordPress 6.8+ wp-bcrypt: "$wp$2y$10$..." format
  // WP pre-hashes with HMAC-SHA384(key='wp-sha384') → base64 → then bcrypt.
  // The "$wp" prefix is 3 chars; slice(3) recovers "$2y$10$..." for bcrypt.compare().
  if (stored.startsWith('$wp$')) {
    const bcryptHash = stored.slice(3); // "$wp$2y$..." → "$2y$10$..."
    const hmacDigest = crypto.createHmac('sha384', 'wp-sha384').update(password, 'utf8').digest();
    const preHashed = hmacDigest.toString('base64');
    const match = await bcrypt.compare(preHashed, bcryptHash);
    if (match) {
      // Silently upgrade to clean bcrypt on next login (no WP pre-hash step needed)
      try {
        const newHash = await bcrypt.hash(password, 10);
        await user.update({ password_hash: newHash });
      } catch (_) { /* non-critical, ignore */ }
      return true;
    }
    return false;
  }

  // phpass or MD5 — WordPress migrated users
  const match = phpass.checkPassword(password, stored);
  if (match === true) {
    // Silently upgrade to bcrypt so next login is faster
    try {
      const newHash = await bcrypt.hash(password, 10);
      await user.update({ password_hash: newHash });
    } catch (_) { /* non-critical, ignore */ }
    return true;
  }

  return false;
}

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function generateSixDigitOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashOtp(purpose, subjectId, otp) {
  return crypto
    .createHmac('sha256', config.otpPepper)
    .update(`${purpose}|${subjectId}|${otp}`)
    .digest('hex');
}

function hashPasswordResetToken(token) {
  return crypto
    .createHmac('sha256', config.otpPepper)
    .update(`password_reset|${token}`)
    .digest('hex');
}

async function saveOtp(purpose, subjectId, otp) {
  const redis = await getRedis();
  const key = `otp:${purpose}:${subjectId}`;
  await redis.setEx(key, config.otpTtlSeconds, hashOtp(purpose, subjectId, otp));
}

async function verifyOtp(purpose, subjectId, otp, { consume = true } = {}) {
  const redis = await getRedis();
  const key = `otp:${purpose}:${subjectId}`;
  const stored = await redis.get(key);
  if (!stored) return false;
  const computed = hashOtp(purpose, subjectId, otp);
  const a = Buffer.from(String(stored), 'utf8');
  const b = Buffer.from(computed, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  if (consume) await redis.del(key);
  return true;
}

async function rateLimitLoginOtp(emailNorm) {
  const redis = await getRedis();
  const key = `ratelimit:login_otp:${emailNorm}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 3600);
  if (n > config.loginOtpMaxPerHour) {
    throw new AppError('Too many code requests. Try again later.', 429);
  }
}

async function rateLimitPasswordReset(emailNorm) {
  const redis = await getRedis();
  const key = `ratelimit:password_reset:${emailNorm}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 3600);
  // Keep slightly stricter than login OTP to reduce abuse.
  if (n > Math.max(3, Math.floor(config.loginOtpMaxPerHour / 2))) {
    throw new AppError('Too many reset requests. Try again later.', 429);
  }
}

function userIsEmailVerified(plain) {
  return plain.email_verified_at != null;
}

const SESSION_USER_ATTRS = [
  'id', 'wp_user_id', 'email', 'name', 'bio', 'role_id', 'password_hash', 'permission_overrides',
  'profile_pic_url', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country',
  'gst', 'referral_code', 'email_verified_at', 'created_at',
];

/** Migrated WP accounts are treated as already verified; new signups keep email_verified_at null until OTP. */
async function ensureMigratedUserEmailVerified(user) {
  if (!user) return;
  const plain = user.get({ plain: true });
  if (userIsEmailVerified(plain) || plain.wp_user_id == null) return;
  const verifiedAt = plain.created_at || new Date();
  await user.update({ email_verified_at: verifiedAt });
  user.set('email_verified_at', verifiedAt);
}

function signAccess(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiry });
}

/** Seconds until access JWT expiry — must match signAccess / JWT_EXPIRY (login used to hardcode 3600). */
function expiresInSecondsFromAccessToken(token) {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded.exp !== 'number') return 3600;
  const remaining = decoded.exp - Math.floor(Date.now() / 1000);
  return remaining > 0 ? remaining : 0;
}

function signRefresh(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiry });
}

function verifyAccess(token) {
  return jwt.verify(token, config.jwt.secret);
}

function verifyRefresh(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

async function hasActiveMembershipForUserId(userId) {
  if (userId == null) return false;
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return false;
  const userRow = await User.findByPk(uid, { attributes: ['id', 'wp_user_id'] });
  const lookupIds = [uid];
  const wp = Number(userRow?.wp_user_id);
  if (Number.isFinite(wp) && wp > 0) lookupIds.push(wp);
  const now = new Date();
  const row = await UserMembership.findOne({
    where: {
      user_id: { [Op.in]: lookupIds },
      starts_at: { [Op.lte]: now },
      expires_at: { [Op.gte]: now },
    },
    order: [['expires_at', 'DESC']],
    attributes: ['id'],
  });
  return !!row;
}

function emptyToNull(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

async function sessionFromUserEntity(user) {

  if (!user) return null;
  const plain = user.get({ plain: true });
  const role = plain.Role?.name || 'user';
  const emailVerified = userIsEmailVerified(plain);
  const accessToken = signAccess({
    userId: plain.id,
    email: plain.email,
    role,
    emailVerified,
  });
  const refreshToken = signRefresh({ userId: plain.id });
  try {
    const redis = await getRedis();
    await redis.setEx(`token:${plain.id}`, config.cacheTtl, accessToken);
  } catch (_) { }
  // Note: Redis caching failure is non-critical; auth proceeds without cache
  const permissions = getEffectivePermissions(
    role,
    plain.permission_overrides,
    parseRolePermissions(plain.Role)
  );
  const has_active_membership = await hasActiveMembershipForUserId(plain.id);
  return {
    token: accessToken,
    accessToken,
    refreshToken,
    user: {
      id: String(plain.id),
      email: plain.email,
      name: plain.name || '',
      bio: plain.bio != null && String(plain.bio).trim() !== '' ? String(plain.bio) : null,
      avatar: plain.profile_pic_url || null,
      phone: plain.phone || null,
      profession: plain.profession || null,
      company: plain.company || null,
      designation: plain.designation || null,
      city: plain.city || null,
      state: plain.state || null,
      country: plain.country || null,
      gst: plain.gst || null,
      referral_code: plain.referral_code || null,
      role,
      permissions,
      has_active_membership,
      email_verified: emailVerified,
      bank_account_holder_name: plain.bank_account_holder_name || null,
      bank_account_number: plain.bank_account_number || null,
      bank_ifsc: plain.bank_ifsc || null,
      bank_name: plain.bank_name || null,
      bank_branch: plain.bank_branch || null,
      bank_details_updated_at: plain.bank_details_updated_at || null,
    },
    expiresIn: expiresInSecondsFromAccessToken(accessToken),
  };
}

/**
 * Save the verification code, then hand the email to SMTP without blocking the
 * response. The account is already committed by the time this runs, so a slow
 * or failing mail server must not time the request out — the browser's 15s
 * limit used to fire first, leaving an account that the obvious retry could
 * only collide with. Delivery failures are recoverable from the OTP screen's
 * "Resend code".
 */
async function dispatchSignupOtp({ userId, email }) {
  const otp = generateSixDigitOtp();
  await saveOtp('verify_email', String(userId), otp);

  emailService
    .sendOtpEmail({ to: email, otp, purpose: 'signup' })
    .then((result) => {
      if (!result.sent) {
        logger.warn('[register] OTP not emailed (configure SMTP_HOST for production)', {
          email,
          otp,
          reason: result.reason,
        });
      }
    })
    .catch((err) => {
      logger.error('[register] OTP email failed — user can request a new code', {
        email,
        err: err?.message || String(err),
      });
    });
}

/** Signup response shape, shared by a fresh account and a resumed one. */
async function signupResultForUser(userId) {
  const withRole = await User.findByPk(userId, {
    include: [roleIncludeForSession()],
    attributes: [
      'id', 'email', 'name', 'referral_code', 'phone', 'profession', 'company', 'designation',
      'city', 'state', 'country', 'gst', 'email_verified_at', 'bank_account_holder_name', 'bank_account_number', 'bank_ifsc', 'bank_name', 'bank_branch', 'bank_details_updated_at',
    ],
  });
  const r = withRole.get({ plain: true });
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.Role?.name || 'user',
    referral_code: r.referral_code,
    has_active_membership: false,
    phone: r.phone,
    profession: r.profession,
    company: r.company,
    designation: r.designation,
    city: r.city,
    state: r.state,
    country: r.country,
    gst: r.gst || null,
    email_verified: userIsEmailVerified(r),
    bank_account_holder_name: r.bank_account_holder_name || null,
    bank_account_number: r.bank_account_number || null,
    bank_ifsc: r.bank_ifsc || null,
    bank_name: r.bank_name || null,
    bank_branch: r.bank_branch || null,
    bank_details_updated_at: r.bank_details_updated_at || null,
  };
}

/**
 * Recover a signup that was committed here but never reached the browser.
 *
 * A dropped connection — or the client timing out on a slow mail server — left
 * an unverified account holding the email and phone, so the natural retry
 * dead-ended on "this email is already registered" with no way forward.
 * Re-submitting the same credentials now resumes that account: new code, new
 * session, same row.
 *
 * Only unverified, self-registered accounts qualify, and only when the password
 * matches — which proves exactly as much as signing in would. Everything else
 * falls through to the usual 409.
 */
async function resumeUnverifiedSignup(existing, { password, name, phoneNorm, phoneOwnerId }) {
  const plain = existing.get({ plain: true });
  if (plain.is_active !== true) return null;
  if (plain.wp_user_id != null) return null; // migrated WP accounts sign in normally
  if (userIsEmailVerified(plain)) return null;

  const passwordValid = await verifyAndMaybeUpgradePassword(password, existing);
  if (!passwordValid) return null;

  // A number that now belongs to somebody else still blocks the retry.
  if (phoneNorm && phoneOwnerId != null && String(phoneOwnerId) !== String(plain.id)) {
    throw new AppError('This phone number is already registered. Sign in or use a different number.', 409);
  }

  const patch = {};
  const nameTrimmed = name ? String(name).trim() : '';
  if (nameTrimmed && nameTrimmed !== plain.name) patch.name = nameTrimmed;
  if (phoneNorm && phoneNorm !== plain.phone) patch.phone = phoneNorm;
  if (Object.keys(patch).length > 0) await existing.update(patch);

  await dispatchSignupOtp({ userId: plain.id, email: plain.email });
  logger.info('[register] resumed an unverified signup', { userId: plain.id });
  return signupResultForUser(plain.id);
}

/**
 * Shared account creation for both signup paths:
 *   register()      — full profile form on /register (unchanged)
 *   registerQuick() — checkout signup on /signup
 * Fields the quick path does not ask for arrive undefined and are stored as null;
 * they are collected later through PATCH /user/profile.
 */
async function createUserAccount({
  email,
  password,
  name,
  referralCode,
  phone,
  profession,
  company,
  designation,
  city,
  state,
  country,
  gst,
}) {
  const userRole = await Role.findOne({
    where: { name: 'user' },
    attributes: ['id'],
  });
  if (!userRole) {
    throw new AppError('Default user role is not configured', 500);
  }

  let referredBy = null;
  if (referralCode) {
    const referrer = await User.findOne({ where: { referral_code: referralCode } });
    if (referrer) referredBy = referrer.id;
  }

  const emailNorm = String(email).trim().toLowerCase();
  const phoneNorm = phone ? String(phone).trim() : null;

  const [existingByEmail, existingByPhone] = await Promise.all([
    User.scope('withPassword').findOne({ where: { email: emailNorm } }),
    phoneNorm ? User.findOne({ where: { phone: phoneNorm }, attributes: ['id'] }) : Promise.resolve(null),
  ]);
  if (existingByEmail) {
    const resumed = await resumeUnverifiedSignup(existingByEmail, {
      password,
      name,
      phoneNorm,
      phoneOwnerId: existingByPhone ? existingByPhone.id : null,
    });
    if (resumed) return resumed;
    throw new AppError('This email is already registered. Try signing in or use a different email.', 409);
  }
  if (existingByPhone) {
    throw new AppError('This phone number is already registered. Sign in or use a different number.', 409);
  }

  const password_hash = await bcrypt.hash(password, 10);
  const newReferralCode = generateReferralCode();
  const user = await User.scope('withPassword').create({
    email: emailNorm,
    password_hash,
    name: name ? String(name).trim() : null,
    phone: phoneNorm,
    profession: profession ? String(profession).trim() : null,
    company: emptyToNull(company),
    designation: emptyToNull(designation),
    city: city ? String(city).trim() : null,
    state: state ? String(state).trim() : null,
    country:
      country != null && String(country).trim() !== ''
        ? String(country).trim()
        : 'India',
    gst: gst ? String(gst).trim() : null,
    role_id: userRole.id,
    referral_code: newReferralCode,
    referred_by: referredBy,
    referred_at: referredBy ? new Date() : null,
    email_verified_at: null
  });

  await dispatchSignupOtp({ userId: user.id, email: emailNorm });

  emailService.sendWelcomeEmail({ to: emailNorm, name: name ? String(name).trim() : null }).catch((err) => {
    logger.warn('[register] Welcome email failed (non-blocking)', { email: emailNorm, err: err?.message });
  });

  return signupResultForUser(user.id);
}

async function register(fields) {
  return createUserAccount(fields);
}

/** Offices and colleges NAT many genuine buyers behind one IP, so the IP bucket is deliberately looser than the per-email one. */
const QUICK_REGISTER_IP_BUCKET_MULTIPLIER = 5;

/**
 * Quick signup is a short public form, so it carries its own throttle — the
 * gateway's rateLimit middleware exists but is not mounted on any route.
 * Per-email stops someone OTP-bombing one inbox. The IP bucket is applied only
 * when a proxy actually gave us a client IP; without that check every signup
 * would share the gateway's own IP and one bucket could lock out the whole site.
 */
async function rateLimitQuickRegister({ emailNorm, clientIp }) {
  const maxPerHour = config.quickRegisterMaxPerHour ?? config.loginOtpMaxPerHour;
  const buckets = [{ key: `ratelimit:register_quick:email:${emailNorm}`, max: maxPerHour }];
  if (clientIp) {
    buckets.push({
      key: `ratelimit:register_quick:ip:${clientIp}`,
      max: maxPerHour * QUICK_REGISTER_IP_BUCKET_MULTIPLIER,
    });
  }

  const redis = await getRedis();
  for (const bucket of buckets) {
    const n = await redis.incr(bucket.key);
    if (n === 1) await redis.expire(bucket.key, 3600);
    if (n > bucket.max) {
      throw new AppError('Too many signup attempts. Try again later.', 429);
    }
  }
}

async function registerQuick({ email, password, name, phone, referralCode, clientIp }) {
  await rateLimitQuickRegister({ emailNorm: String(email).trim().toLowerCase(), clientIp });
  return createUserAccount({ email, password, name, phone, referralCode });
}

async function rateLimitAccountLookup(clientIp) {
  if (!clientIp) return;
  const redis = await getRedis();
  const key = `ratelimit:account_lookup:ip:${clientIp}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 3600);
  // Generous — a buyer correcting a typo on a checkout form should never hit this,
  // while a script walking an address list will.
  if (n > 120) {
    throw new AppError('Too many lookups. Try again later.', 429);
  }
}

/**
 * Does this email already have an account? Drives the checkout form's fork between
 * "sign in to continue" and "pick a password".
 *
 * Deliberately returns nothing but a boolean. It is an enumeration surface, but no
 * more than the sign-in code request already is (that 404s on unknown emails), and
 * asking a buyer to guess whether they have an account is a reliable way to lose the
 * sale. Rate limited per IP.
 */
async function accountExistsForEmail({ email, clientIp }) {
  await rateLimitAccountLookup(clientIp);
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm) return { exists: false };
  const user = await User.findOne({
    where: { email: emailNorm, is_active: true },
    attributes: ['id'],
  });
  return { exists: !!user };
}

async function findActiveUserByLoginIdentifier(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;

  const include = [roleIncludeForSession()];
  const attrs = SESSION_USER_ATTRS;

  if (raw.includes('@')) {
    return User.scope('withPassword').findOne({
      where: { email: raw.toLowerCase(), is_active: true },
      include,
      attributes: attrs,
    });
  }

  const orClauses = [{ login: raw }];
  if (/^\d+$/.test(raw)) {
    const num = Number(raw);
    orClauses.push({ wp_user_id: num }, { id: num });
  }

  return User.scope('withPassword').findOne({
    where: { [Op.or]: orClauses, is_active: true },
    include,
    attributes: attrs,
  });
}

async function loginWithPassword({ email, password }) {
  const user = await findActiveUserByLoginIdentifier(email);
  if (!user) return null;
  const passwordValid = await verifyAndMaybeUpgradePassword(password, user);
  if (!passwordValid) return null;
  await ensureMigratedUserEmailVerified(user);
  return sessionFromUserEntity(user);
}

async function loginWithEmailOtp({ email, otp }) {
  const norm = String(email).trim().toLowerCase();
  const ok = await verifyOtp('login', norm, otp, { consume: true });
  if (!ok) return null;

  const user = await User.findOne({
    where: { email: norm, is_active: true },
    include: [roleIncludeForSession()],
    attributes: SESSION_USER_ATTRS.filter((a) => a !== 'password_hash'),
  });
  if (!user) return null;
  await ensureMigratedUserEmailVerified(user);
  return sessionFromUserEntity(user);
}

async function invalidateOtp(purpose, subjectId) {
  const redis = await getRedis();
  await redis.del(`otp:${purpose}:${subjectId}`);
}

async function requestLoginOtp({ email }) {
  const norm = String(email).trim().toLowerCase();
  await rateLimitLoginOtp(norm);

  const user = await User.findOne({
    where: { email: norm, is_active: true },
    attributes: ['id', 'email'],
  });

  if (!user) {
    throw new AppError('No account found for this email. Please sign up first.', 404);
  }

  const otp = generateSixDigitOtp();
  await saveOtp('login', norm, otp);
  try {
    await emailService.sendOtpEmail({ to: norm, otp, purpose: 'login' });
  } catch (err) {
    logger.error('[requestLoginOtp] send failed', { err: err?.message || err });
    await invalidateOtp('login', norm);
    throw new AppError('Could not send sign-in email. Try again shortly.', 503);
  }

  return { ok: true, message: 'If an account exists for this email, a sign-in code was sent.' };
}

async function verifyEmailWithToken(accessToken, otp) {
  const decoded = verifyAccess(accessToken);
  const userId = decoded.userId;
  const row = await User.findByPk(userId, {
    where: { is_active: true },
    include: [roleIncludeForSession()],
    attributes: SESSION_USER_ATTRS.filter((a) => a !== 'password_hash'),
  });
  if (!row) throw new AppError('User not found or inactive', 401);
  const plain = row.get({ plain: true });
  if (userIsEmailVerified(plain)) {
    return sessionFromUserEntity(row);
  }
  const ok = await verifyOtp('verify_email', String(userId), otp, { consume: true });
  if (!ok) throw new AppError('Invalid or expired verification code', 400);
  await row.update({ email_verified_at: new Date() });
  await row.reload({ include: [roleIncludeForSession()] });
  return sessionFromUserEntity(row);
}

async function resendVerificationEmail(accessToken) {
  const decoded = verifyAccess(accessToken);
  const user = await User.findByPk(decoded.userId, {
    where: { is_active: true },
    attributes: ['id', 'email', 'email_verified_at'],
  });
  if (!user) throw new AppError('User not found or inactive', 401);
  const plain = user.get({ plain: true });
  if (userIsEmailVerified(plain)) {
    throw new AppError('Email is already verified', 400);
  }
  const otp = generateSixDigitOtp();
  await saveOtp('verify_email', String(plain.id), otp);
  try {
    await emailService.sendOtpEmail({ to: plain.email, otp, purpose: 'signup' });
  } catch (err) {
    logger.error('[resendVerificationEmail] send failed', { err: err?.message || err });
    throw new AppError('Could not send email. Try again shortly.', 503);
  }
  return { ok: true };
}

async function validateToken(token) {
  const decoded = verifyAccess(token);
  const user = await User.findByPk(decoded.userId, {
    where: { is_active: true },
    include: [roleIncludeForSession()],
    attributes: [
      'id', 'email', 'name', 'bio', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country',
      'gst', 'permission_overrides', 'referral_code', 'profile_pic_url', 'email_verified_at',
      'bank_account_holder_name', 'bank_account_number', 'bank_ifsc', 'bank_name', 'bank_branch', 'bank_details_updated_at',
    ],
  });
  if (!user) return null;
  const r = user.get({ plain: true });
  const role = r.Role?.name || 'user';
  const permissions = getEffectivePermissions(
    role,
    r.permission_overrides,
    parseRolePermissions(r.Role)
  );
  const has_active_membership = await hasActiveMembershipForUserId(r.id);
  const email_verified = userIsEmailVerified(r);
  return {
    userId: r.id,
    id: String(r.id),
    email: r.email,
    name: r.name || '',
    bio: r.bio != null && String(r.bio).trim() !== '' ? String(r.bio) : null,
    role,
    permissions,
    has_active_membership,
    referral_code: r.referral_code || null,
    avatar: r.profile_pic_url || null,
    phone: r.phone || null,
    profession: r.profession || null,
    company: r.company || null,
    designation: r.designation || null,
    city: r.city || null,
    state: r.state || null,
    country: r.country || null,
    gst: r.gst || null,
    email_verified,
    bank_account_holder_name: r.bank_account_holder_name || null,
    bank_account_number: r.bank_account_number || null,
    bank_ifsc: r.bank_ifsc || null,
    bank_name: r.bank_name || null,
    bank_branch: r.bank_branch || null,
    bank_details_updated_at: r.bank_details_updated_at || null,
  };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  const passwordValid = await verifyAndMaybeUpgradePassword(currentPassword, user);
  if (!passwordValid) throw new AppError('Current password is incorrect', 400);
  const password_hash = await bcrypt.hash(newPassword, 10);
  await user.update({ password_hash });

  const plain = user.get({ plain: true });
  if (plain.email) {
    emailService.sendPasswordChangedEmail({ to: plain.email, name: plain.name }).catch((err) => {
      logger.warn('[changePassword] confirmation email failed (non-blocking)', {
        userId,
        err: err?.message || String(err),
      });
    });
  }
}

const PASSWORD_RESET_TTL_SECONDS = 60 * 30; // 30 minutes

async function requestPasswordReset({ email }) {
  const norm = String(email).trim().toLowerCase();
  await rateLimitPasswordReset(norm);

  const user = await User.findOne({
    where: { email: norm, is_active: true },
    attributes: ['id', 'email'],
  });

  // Always return a generic response, even if no user exists.
  if (!user) {
    return { ok: true, message: 'If an account exists for this email, a reset link was sent.' };
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashPasswordResetToken(token);

  const redis = await getRedis();
  const key = `pwdreset:${tokenHash}`;
  await redis.setEx(key, PASSWORD_RESET_TTL_SECONDS, String(user.id));

  const resetUrl = `${config.publicSiteUrl}/reset-password?token=${encodeURIComponent(token)}`;
  const ttlMinutes = Math.max(1, Math.round(PASSWORD_RESET_TTL_SECONDS / 60));

  try {
    const sendResult = await emailService.sendPasswordResetEmail({
      to: norm,
      resetUrl,
      ttlMinutes,
    });
    if (!sendResult.sent) {
      logger.warn('[passwordReset] email not sent', { email: norm, reason: sendResult.reason });
      await redis.del(key);
      throw new AppError('Password reset email is not configured. Please contact support.', 503);
    }
  } catch (err) {
    logger.error('[passwordReset] send failed', { err: err?.message || err });
    await redis.del(key);
    if (err instanceof AppError) throw err;
    throw new AppError('Could not send reset email. Try again shortly.', 503);
  }

  return { ok: true, message: 'If an account exists for this email, a reset link was sent.' };
}

async function resetPassword({ token, password }) {
  const t = String(token || '').trim();
  if (!t) throw new AppError('Invalid or expired reset token', 400);

  const tokenHash = hashPasswordResetToken(t);
  const redis = await getRedis();
  const key = `pwdreset:${tokenHash}`;
  const userId = await redis.get(key);
  if (!userId) throw new AppError('Invalid or expired reset token', 400);

  const user = await User.scope('withPassword').findByPk(userId);
  if (!user || user.is_active !== true) throw new AppError('User not found or inactive', 404);

  const password_hash = await bcrypt.hash(password, 10);
  await user.update({ password_hash });
  await redis.del(key);
  return { ok: true };
}

async function refreshTokens(refreshToken) {
  const decoded = verifyRefresh(refreshToken);
  const user = await User.findByPk(decoded.userId, {
    where: { is_active: true },
    include: [roleIncludeForSession()],
    attributes: ['id', 'email', 'role_id', 'email_verified_at'],
  });
  if (!user) return null;
  const r = user.get({ plain: true });
  const role = r.Role?.name || 'user';
  const emailVerified = userIsEmailVerified(r);
  const accessToken = signAccess({
    userId: r.id,
    email: r.email,
    role,
    emailVerified,
  });
  return { accessToken, expiresIn: expiresInSecondsFromAccessToken(accessToken) };
}

module.exports = {
  signAccess,
  signRefresh,
  expiresInSecondsFromAccessToken,
  verifyAccess,
  verifyRefresh,
  register,
  registerQuick,
  accountExistsForEmail,
  loginWithPassword,
  loginWithEmailOtp,
  requestLoginOtp,
  verifyEmailWithToken,
  resendVerificationEmail,
  validateToken,
  refreshTokens,
  changePassword,
  requestPasswordReset,
  resetPassword,
  hasActiveMembershipForUserId,
};
