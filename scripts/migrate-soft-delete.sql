-- Soft delete (trash) support — run once on studycafe_db

ALTER TABLE users ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
ALTER TABLE orders ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
ALTER TABLE courses ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;
ALTER TABLE articles ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL;

CREATE INDEX idx_users_deleted_at ON users (deleted_at);
CREATE INDEX idx_orders_deleted_at ON orders (deleted_at);
CREATE INDEX idx_courses_deleted_at ON courses (deleted_at);
CREATE INDEX idx_articles_deleted_at ON articles (deleted_at);
