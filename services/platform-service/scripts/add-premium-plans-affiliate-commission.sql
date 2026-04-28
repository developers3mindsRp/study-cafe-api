-- Per-plan affiliate commission (percentage, 0–100). Apply to the same database as `premium_plans`.
ALTER TABLE premium_plans
  ADD COLUMN affiliate_commission DECIMAL(10, 2) NOT NULL DEFAULT 0
  COMMENT 'Affiliate commission percent of order amount';
