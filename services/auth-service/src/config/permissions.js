const ALL_PERMISSIONS = [
  'articles:list', 'articles:view', 'articles:create', 'articles:edit', 'articles:delete',
  'content:list', 'content:view', 'content:edit',
  'seo:list', 'seo:view', 'seo:create', 'seo:edit', 'seo:delete',
  'memberships:list', 'memberships:view', 'memberships:create', 'memberships:edit', 'memberships:delete',
  'google_reviews:list', 'google_reviews:view', 'google_reviews:create', 'google_reviews:edit', 'google_reviews:delete',
  'testimonials:list', 'testimonials:view', 'testimonials:create', 'testimonials:edit', 'testimonials:delete',
  'faq:list', 'faq:view', 'faq:create', 'faq:edit', 'faq:delete',
  'newsletter:list', 'newsletter:edit', 'newsletter:create', 'newsletter:delete', 'newsletter:send',
  'courses:list', 'courses:view', 'courses:create', 'courses:edit', 'courses:delete',
  'marketing_pages:list', 'marketing_pages:view', 'marketing_pages:create', 'marketing_pages:edit', 'marketing_pages:delete',
  'course_categories:list', 'course_categories:view', 'course_categories:create', 'course_categories:edit', 'course_categories:delete',
  'course_reviews:list', 'course_reviews:view', 'course_reviews:edit', 'course_reviews:delete',
  'media:list', 'media:view', 'media:edit', 'media:delete',
  'orders:list', 'orders:view',
  'coupons:list', 'coupons:view', 'coupons:create', 'coupons:edit', 'coupons:delete',
  'payment_links:list', 'payment_links:view', 'payment_links:create', 'payment_links:edit', 'payment_links:delete',
  'live_sessions:list', 'live_sessions:view',
  'contact_inquiries:list', 'contact_inquiries:view',
  'affiliate:list', 'affiliate:view',
  'downloads:list', 'downloads:view', 'downloads:create', 'downloads:edit', 'downloads:delete',
  'global_settings:list', 'global_settings:view', 'global_settings:edit',
  'admin:access',
  'admin_users:list', 'admin_users:view', 'admin_users:create', 'admin_users:edit', 'admin_users:delete',
  'roles:list', 'roles:view', 'roles:create', 'roles:edit', 'roles:delete',
  'users:course_allotment',
  'banners:list', 'banners:view', 'banners:create', 'banners:edit', 'banners:delete',
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
  google_reviews: [
    ['google_reviews:list', 'google_reviews:view'],
    ['google_reviews:edit'],
    ['google_reviews:create'],
    ['google_reviews:delete'],
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
  newsletter: [
    ['newsletter:list'],
    ['newsletter:edit'],
    ['newsletter:create'],
    ['newsletter:delete'],
  ],
  courses: [
    ['courses:list', 'courses:view'],
    ['courses:edit'],
    ['courses:create'],
    ['courses:delete'],
  ],
  marketing_pages: [
    ['marketing_pages:list', 'marketing_pages:view'],
    ['marketing_pages:edit'],
    ['marketing_pages:create'],
    ['marketing_pages:delete'],
  ],
  course_categories: [
    ['course_categories:list', 'course_categories:view'],
    ['course_categories:edit'],
    ['course_categories:create'],
    ['course_categories:delete'],
  ],
  course_reviews: [
    ['course_reviews:list', 'course_reviews:view'],
    ['course_reviews:edit'],
    ['course_reviews:delete'],
  ],
  media: [
    ['media:list', 'media:view'],
    ['media:edit'],
    ['media:delete'],
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
  payment_links: [
    ['payment_links:list', 'payment_links:view'],
    ['payment_links:edit'],
    ['payment_links:create'],
    ['payment_links:delete'],
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
  downloads: [
    ['downloads:list', 'downloads:view'],
    ['downloads:edit'],
    ['downloads:create'],
    ['downloads:delete'],
  ],
  global_settings: [
    ['global_settings:list', 'global_settings:view'],
    ['global_settings:edit'],
  ],
  admin_users: [
    ['admin_users:list', 'admin_users:view'],
    ['admin_users:edit'],
    ['admin_users:create'],
    ['admin_users:delete'],
  ],
  roles: [
    ['roles:list', 'roles:view'],
    ['roles:edit'],
    ['roles:create'],
    ['roles:delete'],
  ],
  banners: [
    ['banners:list', 'banners:view'],
    ['banners:edit'],
    ['banners:create'],
    ['banners:delete'],
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
    'google_reviews:list', 'google_reviews:view', 'google_reviews:create', 'google_reviews:edit',
    'testimonials:list', 'testimonials:view', 'testimonials:create', 'testimonials:edit',
    'faq:list', 'faq:view', 'faq:create', 'faq:edit',
    'marketing_pages:list', 'marketing_pages:view', 'marketing_pages:create', 'marketing_pages:edit',
    'payment_links:list', 'payment_links:view', 'payment_links:create', 'payment_links:edit',
  ],
  viewer: [
    'articles:list', 'articles:view',
    'content:list', 'content:view',
    'seo:list', 'seo:view',
    'memberships:list', 'memberships:view',
    'google_reviews:list', 'google_reviews:view',
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

/**
 * Effective permissions = role template (DB or static fallback) ∪ user overrides, then hierarchy expansion.
 * @param {string} roleName
 * @param {string[]|null|undefined} permissionOverrides Per-user extras / overrides
 * @param {string[]|null|undefined} rolePermissionsFromDb Permissions JSON from roles.permissions
 */
function getEffectivePermissions(roleName, permissionOverrides, rolePermissionsFromDb = null) {
  if (roleName === 'super_admin') return ALL_PERMISSIONS;

  const overrides = Array.isArray(permissionOverrides) ? permissionOverrides : [];
  const fromDb = Array.isArray(rolePermissionsFromDb) ? rolePermissionsFromDb : null;
  const roleTemplate = fromDb ?? getPermissionsForRole(roleName);
  const merged = [...new Set([...roleTemplate, ...overrides])];
  return expandPermissionHierarchy(merged);
}

function parseRolePermissions(roleRow) {
  if (!roleRow) return null;
  const raw = roleRow.permissions ?? roleRow.get?.('permissions');
  return Array.isArray(raw) ? raw : null;
}

function isAdminRole(roleName) {
  return roleName === 'admin' || roleName === 'super_admin';
}

module.exports = {
  getPermissionsForRole,
  mergePermissions,
  getEffectivePermissions,
  expandPermissionHierarchy,
  parseRolePermissions,
  isAdminRole,
  ALL_PERMISSIONS,
  MODULE_HIERARCHY,
  ROLE_PERMISSIONS,
};
