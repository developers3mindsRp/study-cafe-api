-- Enforce unique phone numbers for non-NULL values (MySQL allows multiple NULLs on a UNIQUE column).
-- Run only after fixing any duplicate phones:
--   SELECT phone, COUNT(*) AS c FROM users WHERE phone IS NOT NULL AND phone <> '' GROUP BY phone HAVING c > 1;
--
-- If the index already exists, skip or use: DROP INDEX uniq_users_phone ON users;

ALTER TABLE users
  ADD UNIQUE INDEX uniq_users_phone (phone);
