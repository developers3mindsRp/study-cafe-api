-- Adds an audit column recording which admin last saved an edit to an article.
-- Paired with the existing `updated_at` to power the "Edited by <name> <time>"
-- column on the admin article listing. Nullable → instant metadata-only change
-- on MySQL 8. Run against studycafe_db (adjust if your database name differs).

ALTER TABLE articles
  ADD COLUMN updated_by BIGINT UNSIGNED NULL
    COMMENT 'users.id of the last admin who saved an edit (listing audit column)'
    AFTER author_id;
