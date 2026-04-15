const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, Role, UserMembership } = require('../models');
const { getRedis } = require('../config/redis');
const config = require('../config');
const { getEffectivePermissions } = require('../config/permissions');
const { AppError } = require('../../../../shared');

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

async function register({ email, password, name }) {
  const userRole = await Role.findOne({
    where: { name: 'user' },
    attributes: ['id'],
  });
  if (!userRole) {
    throw new AppError('Default user role is not configured', 500);
  }

  const password_hash = await bcrypt.hash(password, 10);
  const user = await User.scope('withPassword').create({
    email,
    password_hash,
    name: name || null,
    role_id: userRole.id,
  });
  const withRole = await User.findByPk(user.id, {
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: ['id', 'email', 'name'],
  });
  const r = withRole.get({ plain: true });
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.Role?.name || 'user',
    has_active_membership: false,
  };
}

async function login({ email, password }) {
  const user = await User.scope('withPassword').findOne({
    where: { email, is_active: true },
    include: [{ model: Role, as: 'Role', attributes: ['name'] }],
    attributes: ['id', 'email', 'name', 'bio', 'role_id', 'password_hash', 'permission_overrides'],
  });
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return null;
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
    attributes: ['id', 'email', 'name', 'bio', 'permission_overrides'],
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
  };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.scope('withPassword').findByPk(userId);
  if (!user) throw new AppError('User not found', 404);
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw new AppError('Current password is incorrect', 400);
  }
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