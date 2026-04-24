const authService = require('../services/auth.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent } = require('../../../../shared');

const register = asyncHandler(async (req, res) => {
  const {
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
  } = req.body;
  const user = await authService.register({
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
  });
  const accessToken = authService.signAccess({ userId: user.id, email: user.email, role: user.role });
  const refreshToken = authService.signRefresh({ userId: user.id });
  sendCreated(res, {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      has_active_membership: !!user.has_active_membership,
      phone: user.phone,
      profession: user.profession,
      company: user.company,
      designation: user.designation,
      city: user.city,
      state: user.state,
      country: user.country,
      referral_code: user.referral_code,
    },
    accessToken,
    refreshToken,
    expiresIn: 3600,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.login({ email, password });
  if (!result) throw new AppError('Invalid credentials', 401);
  sendSuccess(res, result);
});

const validate = asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid authorization', 401);
  }
  const token = auth.slice(7);
  const user = await authService.validateToken(token);
  if (!user) throw new AppError('User not found or inactive', 401);
  sendSuccess(res, user);
});

const me = asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid authorization', 401);
  }
  const token = auth.slice(7);
  const user = await authService.validateToken(token);
  if (!user) throw new AppError('User not found or inactive', 401);
  sendSuccess(res, {
    id: user.id || String(user.userId),
    email: user.email,
    name: user.name || '',
    bio: user.bio != null ? String(user.bio) : null,
    role: user.role,
    permissions: user.permissions || [],
    has_active_membership: !!user.has_active_membership,
    referral_code: user.referral_code || null,
    avatar: user.avatar || null,
    phone: user.phone || null,
    profession: user.profession || null,
    company: user.company || null,
    designation: user.designation || null,
    city: user.city || null,
    state: user.state || null,
    country: user.country || null,
  });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError('Refresh token required', 400);
  const result = await authService.refreshTokens(refreshToken);
  if (!result) throw new AppError('User not found', 401);
  sendSuccess(res, result);
});

const changePassword = asyncHandler(async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid authorization', 401);
  }
  const token = auth.slice(7);
  const user = await authService.validateToken(token);
  if (!user) throw new AppError('User not found or inactive', 401);
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!currentPassword || !newPassword) throw new AppError('currentPassword and newPassword required', 400);
  if (confirmPassword && confirmPassword !== newPassword) {
    throw new AppError('Passwords do not match', 400);
  }
  await authService.changePassword(user.userId, { currentPassword, newPassword });
  sendNoContent(res);
});

module.exports = { register, login, validate, me, refresh, changePassword };
