-- Tier rank for upgrade direction enforcement (1=basic, 2=premium, 3=ultimate).
-- Independent of sort_order which controls display order in the frontend.
ALTER TABLE premium_plans
  ADD COLUMN tier_rank TINYINT UNSIGNED NOT NULL DEFAULT 0
  COMMENT 'Upgrade tier rank: 1=basic, 2=premium, 3=ultimate. Higher = higher tier.';

-- Set initial values by slug — adjust if your slugs differ.
UPDATE premium_plans SET tier_rank = 1 WHERE slug = 'basic';
UPDATE premium_plans SET tier_rank = 2 WHERE slug = 'premium';
UPDATE premium_plans SET tier_rank = 3 WHERE slug = 'ultimate';

-- Verify
SELECT id, name, slug, tier_rank, sort_order FROM premium_plans ORDER BY tier_rank;
