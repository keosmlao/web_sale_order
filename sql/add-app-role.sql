-- Adds the per-user role used by the sales mobile app.
-- Values: 'pc', 'salesperson', 'head', 'manager'.
-- NULL is treated as 'salesperson' by the app, so this migration does NOT
-- backfill — only future role changes via the Admin UI populate it.
--
-- Run once against the production database, then `npx prisma generate`
-- so the Prisma client picks up the new field.

ALTER TABLE odg_employee
  ADD COLUMN IF NOT EXISTS app_role VARCHAR(20);

-- Optional: seed yourself as a manager so you can assign roles to others
-- via the in-app Admin screen. Replace the code with your employee_code.
-- UPDATE odg_employee SET app_role = 'manager' WHERE employee_code = 'YOUR_CODE';
