const axios = require('axios');
const config = require('../config');

function getAdminId(req) {
  if (req.user?.userId) return req.user.userId;
  const id = req.headers['x-user-id'];
  return id ? parseInt(id, 10) : null;
}

function getAdminRole(req) {
  return req.user?.role || req.headers['x-user-role'] || '';
}

async function requireAdmin(req, res, next) {
  const role = getAdminRole(req);
  if (role === 'admin' || role === 'super_admin') return next();
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { data } = await axios.get(`${config.authServiceUrl}/auth/validate`, {
      headers: { Authorization: auth },
      timeout: 5000,
    });
    const finalData = data.data || data;
    const permissions = Array.isArray(finalData.permissions) ? finalData.permissions : [];
    const allowed =
      finalData.role === 'admin' ||
      finalData.role === 'super_admin' ||
      permissions.includes('admin:access');
    if (!allowed) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = finalData;
    next();
  } catch (err) {
    const status = err.response?.status || 401;
    const body = err.response?.data || { error: 'Invalid or expired token' };
    res.status(status).json(body);
  }
}

module.exports = { requireAdmin, getAdminId, getAdminRole };
