const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, Role, UserMembership } = require('../models');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getEffectivePermissions } = require('../config/permissions');
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
  'id', 'email', 'name', 'bio', 'role_id', 'password_hash', 'permission_overrides',
  'profile_pic_url', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country',
  'referral_code', 'email_verified_at',
];

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
  const now = new Date();
  const row = await UserMembership.findOne({
    where: {
      user_id: uid,
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
  const permissions = getEffectivePermissions(role, plain.permission_overrides);
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
      referral_code: plain.referral_code || null,
      role,
      permissions,
      has_active_membership,
      email_verified: emailVerified,
    },
    expiresIn: expiresInSecondsFromAccessToken(accessToken),
  };
}

async function register({
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

  const [emailTaken, phoneTaken] = await Promise.all([
    User.findOne({ where: { email: emailNorm }, attributes: ['id'] }),
    phoneNorm ? User.findOne({ where: { phone: phoneNorm }, attributes: ['id'] }) : Promise.resolve(null),
  ]);
  if (emailTaken) {
    throw new AppError('This email is already registered. Try signing in or use a different email.', 409);
  }
  if (phoneTaken) {
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
    role_id: userRole.id,
    referral_code: newReferralCode,
    referred_by: referredBy,
    referred_at: referredBy ? new Date() : null,
    email_verified_at: null,
  });

  const otp = generateSixDigitOtp();
  await saveOtp('verify_email', String(user.id), otp);
  const sendResult = await emailService.sendOtpEmail({ to: emailNorm, otp, purpose: 'signup' });
  if (!sendResult.sent) {
    logger.warn('[register] OTP not emailed (configure SMTP_HOST for production)', {
      email: emailNorm,
      otp,
      reason: sendResult.reason,
    });
  }

  emailService.sendWelcomeEmail({ to: emailNorm, name: name ? String(name).trim() : null }).catch((err) => {
    logger.warn('[register] Welcome email failed (non-blocking)', { email: emailNorm, err: err?.message });
  });

  const withRole = await User.findByPk(user.id, {
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: [
      'id', 'email', 'name', 'referral_code', 'phone', 'profession', 'company', 'designation',
      'city', 'state', 'country', 'email_verified_at',
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
    email_verified: userIsEmailVerified(r),
  };
}

async function loginWithPassword({ email, password }) {
  const norm = String(email).trim().toLowerCase();
  const user = await User.scope('withPassword').findOne({
    where: { email: norm, is_active: true },
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: SESSION_USER_ATTRS,
  });
  if (!user) return null;
  const passwordValid = await verifyAndMaybeUpgradePassword(password, user);
  if (!passwordValid) return null;
  return sessionFromUserEntity(user);
}

async function loginWithEmailOtp({ email, otp }) {
  const norm = String(email).trim().toLowerCase();
  const ok = await verifyOtp('login', norm, otp, { consume: true });
  if (!ok) return null;

  const user = await User.findOne({
    where: { email: norm, is_active: true },
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: SESSION_USER_ATTRS.filter((a) => a !== 'password_hash'),
  });
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
    return { ok: true, message: 'If an account exists for this email, a sign-in code was sent.' };
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
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
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
  await row.reload({ include: [{ model: Role, as: 'Role', attributes: ['name'] }] });
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
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: [
      'id', 'email', 'name', 'bio', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country',
      'permission_overrides', 'referral_code', 'profile_pic_url', 'email_verified_at',
    ],
  });
  if (!user) return null;
  const r = user.get({ plain: true });
  const role = r.Role?.name || 'user';
  const permissions = getEffectivePermissions(role, r.permission_overrides);
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
    email_verified,
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
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
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
