-- Dynamic roles & permissions — run manually on studycafe_db
-- Adds permission templates to roles table (reuses users.permission_overrides pattern)

ALTER TABLE roles
  ADD COLUMN description VARCHAR(255) NULL AFTER name,
  ADD COLUMN permissions JSON NULL COMMENT 'Default permission keys for this role' AFTER description,
  ADD COLUMN is_system TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = built-in role, cannot delete' AFTER permissions,
  ADD COLUMN is_admin_panel TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = assignable to admin panel users' AFTER is_system;

-- Optional: enforce unique role names (skip if duplicate names exist)
-- ALTER TABLE roles ADD UNIQUE KEY uk_roles_name (name);

-- Mark built-in roles
UPDATE roles SET is_system = 1, is_admin_panel = 0 WHERE name = 'user';
UPDATE roles SET is_system = 1, is_admin_panel = 1
WHERE name IN ('super_admin', 'admin', 'editor', 'viewer', 'editor_articles', 'custom');

-- Any other existing roles default to admin-panel assignable
UPDATE roles SET is_admin_panel = 1
WHERE is_system = 0 AND name NOT IN ('user');

-- Note: permissions JSON is auto-seeded on auth-service startup via rolesBootstrap
-- if columns exist but permissions is NULL/empty for system roles.
