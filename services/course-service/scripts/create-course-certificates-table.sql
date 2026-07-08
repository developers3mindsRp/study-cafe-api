-- Global certificate serials. One row per (user_id, course_id), assigned the first time a learner
-- opens/downloads their certificate. `serial` is a SINGLE global running number across the whole
-- platform (not per-course), allocated from the `certificate_counter` table. Serials are unique
-- system-wide and never restart per course. Run once on studycafe MySQL.
CREATE TABLE IF NOT EXISTS course_certificates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  serial INT UNSIGNED NOT NULL,
  issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cert_user_course (user_id, course_id),
  UNIQUE KEY uq_cert_serial (serial)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Single-row atomic counter for the global serial. Seeded so the first allocation returns
-- START_SERIAL (5000). `current_serial` holds the last-issued value; the app does an atomic
-- UPDATE ... = current_serial + 1 and reads it back, so concurrent requests never collide.
CREATE TABLE IF NOT EXISTS certificate_counter (
  id TINYINT UNSIGNED NOT NULL,
  current_serial INT UNSIGNED NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the counter at START_SERIAL - 1 (= 4999) so the first UPDATE ... +1 yields 5000.
-- IGNORE keeps this idempotent — re-running never resets an already-advanced counter.
INSERT IGNORE INTO certificate_counter (id, current_serial) VALUES (1, 4999);
