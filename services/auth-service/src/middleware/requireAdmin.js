const authService = require('../services/auth.service');
const { User, Role } = require('../models');
const { getEffectivePermissions } = require('../config/permissions');

const ADMIN_ROLES = ['super_admin'];

async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }
  const token = auth.slice(7);
  try {
    const decoded = authService.verifyAccess(token);
    const user = await User.findByPk(decoded.userId, {
      where: { is_active: true },
      include: [{ model: Role, as: 'Role', attributes: ['name'] }],
      attributes: ['id', 'email', 'name', 'role_id', 'permission_overrides'],
    });
    if (!user) return res.status(401).json({ error: 'User not found or inactive' });
    const roleName = user.Role?.name || 'user';
    // Use same logic as login: super_admin/admin → ALL_PERMISSIONS, others → their overrides
    const permissions = getEffectivePermissions(roleName, user.permission_overrides ?? []);
    const hasAdminAccess = permissions.includes('admin:access');
    if (!hasAdminAccess) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminUser = { id: user.id, email: user.email, role: roleName, permissions };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requirePermission(...permissionKeys) {
  return async (req, res, next) => {
    if (!req.adminUser) return res.status(401).json({ error: 'Unauthorized' });
    const { permissions } = req.adminUser;
    const has = permissionKeys.some((p) => permissions.includes(p));
    if (!has) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}

module.exports = { requireAdmin, requirePermission };
