const authService = require('../services/auth.service');

/**
 * Validates Bearer JWT and sets req.user (same shape as /auth/me).
 */
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing authorization' });
  }
  const token = auth.slice(7);
  return authService
    .validateToken(token)
    .then((user) => {
      if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
      req.user = user;
      next();
    })
    .catch(() => res.status(401).json({ success: false, message: 'Unauthorized' }));
}

module.exports = { requireAuth };
