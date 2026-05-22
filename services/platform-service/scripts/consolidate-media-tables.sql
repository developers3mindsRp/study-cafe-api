-- =============================================================================
-- Unified media table (upgrade ONLY — not the main WordPress migration)
-- =============================================================================
-- Full WordPress → microservices sync already includes this in migrate-wp-to-ms.js:
--   npm run migrate:wp-to-ms   or   npm run sync
--
-- Use this script only for an existing DB that was NOT re-synced from WordPress:
--   cd services/platform-service && npm run db:consolidate-media
-- (idempotent Node runner — preferred over this .sql file)
-- =============================================================================

-- 1) New columns for admin Media Library + icon picker
ALTER TABLE media
  ADD COLUMN label VARCHAR(128) NULL,
  ADD COLUMN category VARCHAR(64) NULL DEFAULT 'library';

-- 2) Widen columns for CDN URLs and full MIME types
ALTER TABLE media
  MODIFY COLUMN url VARCHAR(512) NULL,
  MODIFY COLUMN mime_type VARCHAR(128) NULL;

-- 3) Backfill legacy WordPress rows
UPDATE media SET category = 'library' WHERE category IS NULL;

UPDATE media
SET label = title
WHERE (label IS NULL OR TRIM(label) = '')
  AND title IS NOT NULL AND TRIM(title) != '';

-- 4) Merge media_assets into media (skip duplicates by url + category)
-- If media_assets has mime_type (optional prior migration), add ma.mime_type to SELECT list.
INSERT INTO media (url, label, title, category, created_at)
SELECT ma.url, ma.label, ma.label, ma.category, ma.created_at
FROM media_assets ma
WHERE ma.url IS NOT NULL AND TRIM(ma.url) != ''
  AND NOT EXISTS (
    SELECT 1 FROM media m
    WHERE m.url = ma.url AND (m.category <=> ma.category)
  );

-- With mime_type on media_assets (uncomment if that column exists):
-- INSERT INTO media (url, label, title, mime_type, category, created_at)
-- SELECT ma.url, ma.label, ma.label, ma.mime_type, ma.category, ma.created_at
-- FROM media_assets ma
-- WHERE ma.url IS NOT NULL AND TRIM(ma.url) != ''
--   AND NOT EXISTS (
--     SELECT 1 FROM media m
--     WHERE m.url = ma.url AND (m.category <=> ma.category)
--   );

-- 5) Drop old registry table (app now uses `media` only)
DROP TABLE IF EXISTS media_assets;

-- 6) Indexes for filtered library / icon queries
CREATE INDEX idx_media_category ON media (category);
CREATE INDEX idx_media_url ON media (url(191));
