const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { User, Role, UserMembership } = require('../models');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getEffectivePermissions } = require('../config/permissions');
const { AppError } = require('../../../../shared');
const phpass = require('../utils/phpass');

/**
 * Verify a password against any supported hash format:
 *   - bcrypt ($2a$, $2b$, $2y$)  — new registrations from this app
 *   - phpass ($P$, $H$)           — WordPress migrated users
 *   - plain MD5 (32 hex chars)    — very old WordPress accounts
 *
 * On a successful phpass/MD5 login we silently upgrade the stored hash to bcrypt.
 */
async function verifyAndMaybeUpgradePassword(password, user) {
  const stored = user.password_hash;
  if (!stored) return false;

  // bcrypt — the normal path for new users
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    return bcrypt.compare(password, stored);
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

function signAccess(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiry });
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
    country: country ? String(country).trim() : null,
    role_id: userRole.id,
    referral_code: newReferralCode,
    referred_by: referredBy,
    referred_at: referredBy ? new Date() : null,
  });
  const withRole = await User.findByPk(user.id, {
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: [
      'id', 'email', 'name', 'referral_code', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country',
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
  };
}

async function login({ email, password }) {
  const user = await User.scope('withPassword').findOne({
    where: { email, is_active: true },
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: ['id', 'email', 'name', 'bio', 'role_id', 'password_hash', 'permission_overrides',
      'profile_pic_url', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country', 'referral_code'],
  });
  if (!user) return null;
  const passwordValid = await verifyAndMaybeUpgradePassword(password, user);
  if (!passwordValid) return null;
  const plain = user.get({ plain: true });
  const role = plain.Role?.name || 'user';
  const accessToken = signAccess({ userId: plain.id, email: plain.email, role });
  const refreshToken = signRefresh({ userId: plain.id });
  try {
    const redis = await getRedis();
    await redis.setEx(`token:${plain.id}`, config.cacheTtl, accessToken);
  } catch (_) {}
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
    },
    expiresIn: 3600,
  };
}

async function validateToken(token) {
  const decoded = verifyAccess(token);
  const user = await User.findByPk(decoded.userId, {
    where: { is_active: true },
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: ['id', 'email', 'name', 'bio', 'phone', 'profession', 'company', 'designation', 'city', 'state', 'country', 'permission_overrides', 'referral_code', 'profile_pic_url'],
  });
  if (!user) return null;
  const r = user.get({ plain: true });
  const role = r.Role?.name || 'user';
  const permissions = getEffectivePermissions(role, r.permission_overrides);
  const has_active_membership = await hasActiveMembershipForUserId(r.id);
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
  };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  const passwordValid = await verifyAndMaybeUpgradePassword(currentPassword, user);
  if (!passwordValid) throw new AppError('Current password is incorrect', 400);
  const password_hash = await bcrypt.hash(newPassword, 10);
  await user.update({ password_hash });
}

async function refreshTokens(refreshToken) {
  const decoded = verifyRefresh(refreshToken);
  const user = await User.findByPk(decoded.userId, {
    where: { is_active: true },
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: ['id', 'email', 'name'],
  });
  if (!user) return null;
  const r = user.get({ plain: true });
  const accessToken = signAccess({ userId: r.id, email: r.email, role: r.Role?.name || 'user' });
  return { accessToken, expiresIn: 3600 };
}

module.exports = {
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
  register,
  login,
  validateToken,
  refreshTokens,
  changePassword,
  hasActiveMembershipForUserId,
};