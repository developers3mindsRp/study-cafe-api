-- Payment Links (admin-managed checkout pages)
CREATE TABLE IF NOT EXISTS payment_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description LONGTEXT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  sale_price DECIMAL(12, 2) NOT NULL,
  expiry DATETIME NOT NULL,
  total_seats INT UNSIGNED NOT NULL DEFAULT 0,
  seats_booked INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'unused; paid count from orders',
  random_value VARCHAR(32) NULL,
  random_boost_accumulator INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  product_type VARCHAR(20) NOT NULL DEFAULT 'custom' COMMENT 'custom | course | membership',
  product_id VARCHAR(64) NULL COMMENT 'course id or membership plan id, per product_type',
  batch_id BIGINT UNSIGNED NULL COMMENT 'course links only; NULL = auto-select at purchase',
  auto_enroll TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_payment_links_slug (slug),
  KEY idx_payment_links_status (status),
  KEY idx_payment_links_product (product_type, product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
