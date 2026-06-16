-- Speed up membership filters, latest-membership lookups, and export batches.
-- Apply to the same database as auth-service / user_memberships.

ALTER TABLE user_memberships
  ADD INDEX idx_user_memberships_user_id (user_id),
  ADD INDEX idx_user_memberships_user_expires (user_id, expires_at),
  ADD INDEX idx_user_memberships_type_expires (membership_type, expires_at),
  ADD INDEX idx_user_memberships_user_id_id (user_id, id);
