const axios = require('axios');
const config = require('../config');

function parseUserId(raw) {
  if (raw == null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? raw : n;
}

function getUserId(req) {
  const xUserId = req.headers['x-user-id'];
  if (xUserId) return parseUserId(xUserId);
  const user = req.user;
  if (user && user.userId != null) return parseUserId(user.userId);
  if (user && user.id != null) return parseUserId(user.id);
  return null;
}

/**
 * Prefer X-User-Id from api-gateway; if missing, validate Bearer token with auth-service
 * (covers gateway proxy bugs and local calls with only Authorization).
 */
async function requireUserId(req, res, next) {
  try {
    let userId = getUserId(req);

    if (!userId && req.headers.authorization) {
      try {
        const { data: body } = await axios.get(`${config.authServiceUrl}/auth/validate`, {
          headers: { Authorization: req.headers.authorization },
          timeout: 5000,
        });
        const u =
          body && typeof body === 'object' && body.data != null && typeof body.data === 'object'
            ? body.data
            : body;
        const raw = u?.userId ?? u?.id;
        userId = raw != null ? parseUserId(raw) : null;
      } catch {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    if (!userId) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Send Authorization: Bearer <token> or X-User-Id (internal)',
      });
    }

    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { getUserId, requireUserId };
