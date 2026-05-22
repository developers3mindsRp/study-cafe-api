-- Fix premium_plans sort_order so upgrade direction is correct:
-- basic=1, premium=2, ultimate=3
-- Run once against studycafe_db.

UPDATE premium_plans SET sort_order = 1 WHERE slug = 'basic';
UPDATE premium_plans SET sort_order = 2 WHERE slug = 'premium';
UPDATE premium_plans SET sort_order = 3 WHERE slug = 'ultimate';

-- Verify
SELECT id, name, slug, sort_order FROM premium_plans ORDER BY sort_order;
