-- 1) Article tier column (run once; ignore error if column already exists).
ALTER TABLE articles
  ADD COLUMN blog_access_tier VARCHAR(20) NOT NULL DEFAULT 'free' AFTER published_at;

-- 2) Legacy users without role_id — core roles are ensured at auth-service startup;
--    this SQL is optional if you prefer a one-off DB fix:
-- UPDATE users u INNER JOIN roles r ON r.name = 'user' SET u.role_id = r.id WHERE u.role_id IS NULL;
