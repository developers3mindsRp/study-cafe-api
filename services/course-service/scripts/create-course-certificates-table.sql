-- Per-course certificate numbers. One row per (user_id, course_id), assigned the first time a
-- learner opens/downloads their certificate. `cert_seq` is a per-course running number starting at 1;
-- the display serial ("0001") is derived at read time via padStart(4,'0'). Run once on studycafe MySQL.
CREATE TABLE IF NOT EXISTS course_certificates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  cert_seq INT UNSIGNED NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cert_user_course (user_id, course_id),
  UNIQUE KEY uq_cert_course_seq (course_id, cert_seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
