-- App-local employee access table.
-- odg_employee remains the source of employee identity/profile data.
-- This table controls who can use this app and what app role/position they have.

CREATE TABLE IF NOT EXISTS app_employee_access (
  employee_code VARCHAR(20) PRIMARY KEY,
  app_role VARCHAR(20) NOT NULL DEFAULT 'salesperson',
  position_code VARCHAR(20),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by VARCHAR(20),
  updated_by VARCHAR(20),
  CONSTRAINT app_employee_access_role_chk
    CHECK (app_role IN ('pc', 'salesperson', 'head', 'manager'))
);

CREATE INDEX IF NOT EXISTS app_employee_access_role_idx
  ON app_employee_access (app_role);

CREATE INDEX IF NOT EXISTS app_employee_access_active_idx
  ON app_employee_access (is_active);

-- Preserve existing explicit app roles as initial app access rows.
INSERT INTO app_employee_access (employee_code, app_role, position_code, is_active)
SELECT employee_code, app_role, position_code, employment_status = 'ACTIVE'
FROM odg_employee
WHERE employee_code IS NOT NULL
  AND app_role IN ('pc', 'salesperson', 'head', 'manager')
ON CONFLICT (employee_code) DO NOTHING;
