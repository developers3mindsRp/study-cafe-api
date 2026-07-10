-- Creates the `professions` master-data table (admin CRUD + public /platform/professions API).
-- Idempotent: safe to re-run. Not required in normal dev — Profession.sync() in models/index.js
-- creates this table automatically on service startup if missing, same as `products`.
CREATE TABLE IF NOT EXISTS professions (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(150) NOT NULL,
  status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
