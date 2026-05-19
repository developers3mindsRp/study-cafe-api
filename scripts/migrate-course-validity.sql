-- Migration: Course Validity Feature
-- Run these statements once against the production database.
-- Safe to run on existing data: default values preserve current behavior.

-- 1. Add validity column to courses table (default '1year')
--    Existing courses will have validity='1year' but their user_courses rows
--    will have expires_at=NULL (lifetime) so no access is lost.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS validity VARCHAR(20) NOT NULL DEFAULT '1year';

-- 2. Add expires_at column to user_courses table (nullable = lifetime)
--    All existing rows get expires_at=NULL which means lifetime access — no breakage.
ALTER TABLE user_courses
  ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL DEFAULT NULL;
