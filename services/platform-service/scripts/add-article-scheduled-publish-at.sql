-- Adds optional scheduled publish datetime for BullMQ-driven article scheduling.
-- Run against studycafe_db (adjust if your database name differs).

ALTER TABLE articles
  ADD COLUMN scheduled_publish_at DATETIME NULL
    COMMENT 'When status=scheduled, article transitions to publish at this time (UTC stored by app)'
    AFTER published_at;
