const authService = require('../services/auth.service');
const { asyncHandler, AppError, sendSuccess, sendCreated, sendNoContent } = require('../../../../shared');

function bearerToken(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

/** Client IP from the proxy chain, or null when nothing upstream set one (see rateLimitQuickRegister). */
function forwardedClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 45);
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim().slice(0, 45);
  return null;
}

/** Session payload returned by both signup paths — keep the shape identical. */
function newAccountSession(user) {
  const accessToken = authService.signAccess({
    userId: user.id,
    email: user.email,
    role: user.role,
    emailVerified: !!user.email_verified,
  });
  const refreshToken = authService.signRefresh({ userId: user.id });
  return {
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
      gst: user.gst || null,
      referral_code: user.referral_code,
      email_verified: !!user.email_verified,
    },
    accessToken,
    refreshToken,
    expiresIn: authService.expiresInSecondsFromAccessToken(accessToken),
  };
}

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
    gst,
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
    gst,
  });
  sendCreated(res, newAccountSession(user));
});

/** Checkout signup: name, email, phone, password only — everything else is collected after purchase. */
const registerQuick = asyncHandler(async (req, res) => {
  const { email, password, confirmPassword, name, phone, referralCode } = req.body;
  if (confirmPassword && confirmPassword !== password) {
    throw new AppError('Passwords do not match', 400);
  }
  const user = await authService.registerQuick({
    email,
    password,
    name,
    phone,
    referralCode,
    clientIp: forwardedClientIp(req),
  });
  sendCreated(res, newAccountSession(user));
});

/** Checkout fork: does this buyer already have an account, or do they need to make one? */
const accountExists = asyncHandler(async (req, res) => {
  const out = await authService.accountExistsForEmail({
    email: req.body.email,
    clientIp: forwardedClientIp(req),
  });
  sendSuccess(res, out);
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const result = await authService.loginWithPassword({ email, password });
  if (!result) throw new AppError('Invalid credentials', 401);
  sendSuccess(res, result);
});

const loginRequestOtp = asyncHandler(async (req, res) => {
  const out = await authService.requestLoginOtp({ email: req.body.email });
  sendSuccess(res, out);
});

const loginWithOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const result = await authService.loginWithEmailOtp({ email, otp });
  if (!result) throw new AppError('Invalid or expired code', 401);
  sendSuccess(res, result);
});

const verifyEmail = asyncHandler(async (req, res) => {
  const token = bearerToken(req);
  if (!token) throw new AppError('Missing or invalid authorization', 401);
  const { otp } = req.body;
  const result = await authService.verifyEmailWithToken(token, otp);
  sendSuccess(res, result);
});

const resendVerificationEmail = asyncHandler(async (req, res) => {
  const token = bearerToken(req);
  if (!token) throw new AppError('Missing or invalid authorization', 401);
  const result = await authService.resendVerificationEmail(token);
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
    gst: user.gst || null,
    email_verified: !!user.email_verified,
    bank_account_holder_name: user.bank_account_holder_name || null,
    bank_account_number: user.bank_account_number || null,
    bank_ifsc: user.bank_ifsc || null,
    bank_name: user.bank_name || null,
    bank_branch: user.bank_branch || null,
    bank_details_updated_at: user.bank_details_updated_at || null,
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

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const out = await authService.requestPasswordReset({ email });
  sendSuccess(res, out);
});

const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  await authService.resetPassword({ token, password });
  sendNoContent(res);
});

module.exports = {
  register,
  registerQuick,
  accountExists,
  login,
  loginRequestOtp,
  loginWithOtp,
  verifyEmail,
  resendVerificationEmail,
  validate,
  me,
  refresh,
  changePassword,
  forgotPassword,
  resetPassword,
};
