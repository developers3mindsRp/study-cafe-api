const ALL_PERMISSIONS = [
  'articles:list', 'articles:view', 'articles:create', 'articles:edit', 'articles:delete',
  'content:list', 'content:view', 'content:edit',
  'seo:list', 'seo:view', 'seo:create', 'seo:edit', 'seo:delete',
  'memberships:list', 'memberships:view', 'memberships:create', 'memberships:edit', 'memberships:delete',
  'testimonials:list', 'testimonials:view', 'testimonials:create', 'testimonials:edit', 'testimonials:delete',
  'faq:list', 'faq:view', 'faq:create', 'faq:edit', 'faq:delete',
  'courses:list', 'courses:view', 'courses:create', 'courses:edit', 'courses:delete',
  'orders:list', 'orders:view',
  'coupons:list', 'coupons:view', 'coupons:create', 'coupons:edit', 'coupons:delete',
  'live_sessions:list', 'live_sessions:view',
  'contact_inquiries:list', 'contact_inquiries:view',
  'affiliate:list', 'affiliate:view',
  'admin:access',
  'admin_users:list', 'admin_users:view', 'admin_users:create', 'admin_users:edit', 'admin_users:delete',
];
const MODULE_HIERARCHY = {
  articles: [
    ['articles:list', 'articles:view'],
    ['articles:edit'],
    ['articles:create'],
    ['articles:delete'],
  ],
  content: [
    ['content:list', 'content:view'],
    ['content:edit'],
  ],
  seo: [
    ['seo:list', 'seo:view'],
    ['seo:edit'],
    ['seo:create'],
    ['seo:delete'],
  ],
  memberships: [
    ['memberships:list', 'memberships:view'],
    ['memberships:edit'],
    ['memberships:create'],
    ['memberships:delete'],
  ],
  testimonials: [
    ['testimonials:list', 'testimonials:view'],
    ['testimonials:edit'],
    ['testimonials:create'],
    ['testimonials:delete'],
  ],
  faq: [
    ['faq:list', 'faq:view'],
    ['faq:edit'],
    ['faq:create'],
    ['faq:delete'],
  ],
  courses: [
    ['courses:list', 'courses:view'],
    ['courses:edit'],
    ['courses:create'],
    ['courses:delete'],
  ],
  orders: [
    ['orders:list', 'orders:view'],
  ],
  coupons: [
    ['coupons:list', 'coupons:view'],
    ['coupons:edit'],
    ['coupons:create'],
    ['coupons:delete'],
  ],
  live_sessions: [
    ['live_sessions:list', 'live_sessions:view'],
  ],
  contact_inquiries: [
    ['contact_inquiries:list', 'contact_inquiries:view'],
  ],
  affiliate: [
    ['affiliate:list', 'affiliate:view'],
  ],
  admin_users: [
    ['admin_users:list', 'admin_users:view'],
    ['admin_users:edit'],
    ['admin_users:create'],
    ['admin_users:delete'],
  ],
};

function expandPermissionHierarchy(permissionOverrides) {
  const input = Array.isArray(permissionOverrides) ? permissionOverrides : [];
  const result = new Set(input);
  const allPermsSet = new Set(ALL_PERMISSIONS);

  for (const moduleKey of Object.keys(MODULE_HIERARCHY)) {
    const levels = MODULE_HIERARCHY[moduleKey];
    let maxLevel = -1;
    for (let i = 0; i < levels.length; i++) {
      const hasAny = levels[i].some((p) => input.includes(p));
      if (hasAny) maxLevel = i;
    }
    for (let i = 0; i <= maxLevel; i++) {
      levels[i].forEach((p) => result.add(p));
    }
  }

  return [...result].filter((p) => allPermsSet.has(p));
}

const ROLE_PERMISSIONS = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  editor: [
    'articles:list', 'articles:view', 'articles:create', 'articles:edit',
    'content:list', 'content:view', 'content:edit',
    'testimonials:list', 'testimonials:view', 'testimonials:create', 'testimonials:edit',
    'faq:list', 'faq:view', 'faq:create', 'faq:edit',
  ],
  viewer: [
    'articles:list', 'articles:view',
    'content:list', 'content:view',
    'seo:list', 'seo:view',
    'memberships:list', 'memberships:view',
    'testimonials:list', 'testimonials:view',
    'faq:list', 'faq:view',
  ],
  
  editor_articles: [
    'admin:access',
    'articles:list', 'articles:view', 'articles:create', 'articles:edit', 'articles:delete',
  ],
  custom: [],
  user: [],
};

function getPermissionsForRole(roleName) {
  if (!roleName) return [];
  const name = roleName.toLowerCase();
  return ROLE_PERMISSIONS[name] || [];
}

function mergePermissions(roleName, permissionOverrides) {
  const rolePerms = getPermissionsForRole(roleName);
  const overrides = Array.isArray(permissionOverrides) ? permissionOverrides : [];
  return [...new Set([...rolePerms, ...overrides])];
}

function getEffectivePermissions(roleName, permissionOverrides) {
  if (roleName === 'super_admin') return ALL_PERMISSIONS;
  const list = Array.isArray(permissionOverrides) ? permissionOverrides : [];
  // admin (and other roles) use only what is stored; expand module ladders for consistency
  return expandPermissionHierarchy(list);
}

function isAdminRole(roleName) {
  return roleName === 'admin' || roleName === 'super_admin';
}

module.exports = {
  getPermissionsForRole,
  mergePermissions,
  getEffectivePermissions,
  expandPermissionHierarchy,
  isAdminRole,
  ALL_PERMISSIONS,
  MODULE_HIERARCHY,
};
