-- ============================================================================
-- LINE Login — link a LINE account (from the shop's LINE OA / LINE Login
-- channel) to an employee, so staff can sign in with LINE instead of typing
-- their employee code + password every time.
--
-- First LINE sign-in: the app asks for employee code + password once, then
-- stores the link here. Later sign-ins match line_user_id → employee_code.
--
-- Run:  node scripts/apply-sql.mjs sql/add-line-login.sql
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_employee_line (
  line_user_id  TEXT PRIMARY KEY,
  employee_code TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_employee_line_emp
  ON app_employee_line (employee_code);
