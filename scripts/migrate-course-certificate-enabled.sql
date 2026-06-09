-- Per-course toggle: whether learners receive a completion certificate.
-- Default TRUE keeps existing courses unchanged.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS certificate_enabled TINYINT(1) NOT NULL DEFAULT 1;
