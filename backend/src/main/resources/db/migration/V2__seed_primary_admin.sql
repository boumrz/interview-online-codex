-- V2__seed_primary_admin.sql
-- Ensure the primary admin account has role = 'admin'.
-- Safe: only updates when the row exists and role differs.
UPDATE users
SET    role = 'admin'
WHERE  nickname = 'boumrz'
  AND  role <> 'admin';
